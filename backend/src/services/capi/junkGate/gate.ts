/**
 * The junk conversion gate (GA4 Admin / L11 / Junk Gate PRD Part C). C1: observe; C2: enforce.
 *
 * Placement (PRD §C.4, decided in Sprint 0.3): in `processEvent()` after enrichment and the
 * consent gate, before dedup. The gate therefore only ever sees events that passed consent, so
 * the IP/UA it reads add no processing beyond what consent already allows for delivery.
 * `processServerSourcedEvent()` (Shopify, outcomes) does not call it — out of scope (§C.4).
 *
 * `observe` (the default) NEVER delays, blocks or alters an event: every outcome has
 * `action: 'send'`. Only a client whose saved mode is `enforce` can get `hold` / `drop`, and only
 * for a `junk` / `suspect` verdict whose configured action says so. The gate always fails OPEN:
 * any error, a timeout, or a failure to persist the hold record leaves delivery untouched.
 *
 * IP / user agent: read ONLY from `event.user_data.client_ip_address` / `client_user_agent`
 * (filled by `applyIdentityConfig()` when the client's identity config enables auto-capture).
 * The route deliberately does NOT inject `req.ip`: `/api/capi/process` is called with an Atlas
 * user's token, so the request address would be the operator's or a relay's, not the visitor's —
 * counting it would flag every legitimate lead from one relay. Without those fields the two
 * dependent rules (JC_NON_HUMAN_UA, JC_SUBMIT_VELOCITY) simply cannot fire.
 *
 * Nothing logged or stored here is PII: hashes, rule ids and non-PII evidence only.
 */
import type { AtlasEvent, CAPIProviderConfig } from '@/types/capi';
import { evaluateJunkRules } from './evaluator';
import { resolveGateConfig, isEventInScope } from './config';
import { clampHoldTimeout, holdCeilingHours } from './holdWindows';
import { classifyDelivery, classifyDestination } from './deliveryClass';
import {
  createDefaultStore, sha256, normaliseEmailForHash, normalisePhoneForHash, type JunkGateStore, type VerdictMemo,
} from './store';
import type { JunkGateConfig, JunkRuleInput, JunkVerdict, RuleHit } from './types';
import {
  getClientIdForProvider, getJunkGateConfigRow, insertObservedRecord, appendProviderConfigId,
  getHoldById, updateHoldBinding,
} from '@/services/database/junkGateQueries';
import logger from '@/utils/logger';

export const GATE_TIMEOUT_MS = 1500;
const CLIENT_CACHE_TTL_MS = 60_000;

export interface JunkGateOutcome {
  /** 'send' unless the client is in enforce mode and the verdict's configured action says otherwise. */
  action: 'send' | 'hold' | 'drop';
  /** conversion_holds row id for a hold / drop. */
  record_id?: string | null;
  /** ISO expiry of a freshly created hold (the call that created it schedules the timeout job). */
  expires_at?: string | null;
  evaluated: boolean;
  mode: JunkGateConfig['mode'];
  verdict?: JunkVerdict;
  hits?: RuleHit[];
  /** True when this call reused another provider call's verdict instead of evaluating. */
  memoised?: boolean;
  /** Why nothing was evaluated. */
  skipped?: 'off' | 'out_of_scope' | 'error' | 'timeout' | 'pending_timeout';
}

export interface GateDeps {
  store: JunkGateStore;
  getClientId: (providerConfigId: string) => Promise<string | null>;
  getConfigRow: (clientId: string) => Promise<Parameters<typeof resolveGateConfig>[0]>;
  insertRecord: typeof insertObservedRecord;
  appendProvider: typeof appendProviderConfigId;
  /** A later provider call joins an existing hold: tighten expiry to its window, widen delivery class. */
  bindHold: (recordId: string, providerConfig: CAPIProviderConfig) => Promise<void>;
  now: () => number;
}

/** Re-clamps an open hold for a newly bound destination (shortest window wins; hybrid is sticky). */
export async function bindProviderToHold(recordId: string, providerConfig: CAPIProviderConfig): Promise<void> {
  const hold = await getHoldById(recordId);
  if (!hold || hold.status !== 'held') return;
  const ceiling = holdCeilingHours([providerConfig.provider]);
  const patch: Parameters<typeof updateHoldBinding>[1] = {};
  const applied = hold.timeout_hours_applied ?? ceiling;
  if (ceiling < applied) {
    patch.timeout_hours_applied = ceiling;
    patch.timeout_clamped = true;
    patch.expires_at = new Date(new Date(hold.created_at).getTime() + ceiling * 3_600_000).toISOString();
  }
  if (hold.delivery_class !== 'hybrid' && classifyDestination(providerConfig.provider) === 'hybrid') patch.delivery_class = 'hybrid';
  if (Object.keys(patch).length > 0) await updateHoldBinding(recordId, patch);
}

let defaultStore: JunkGateStore | null = null;
const clientCache = new Map<string, { clientId: string | null; config: JunkGateConfig; at: number }>();

export function clearGateCaches(): void {
  clientCache.clear();
}

function defaultDeps(): GateDeps {
  defaultStore ??= createDefaultStore();
  return {
    store: defaultStore,
    getClientId: getClientIdForProvider,
    getConfigRow: getJunkGateConfigRow,
    insertRecord: insertObservedRecord,
    appendProvider: appendProviderConfigId,
    bindHold: bindProviderToHold,
    now: Date.now,
  };
}

async function resolveClientAndConfig(providerConfigId: string, deps: GateDeps): Promise<{ clientId: string | null; config: JunkGateConfig }> {
  const cached = clientCache.get(providerConfigId);
  if (cached && deps.now() - cached.at < CLIENT_CACHE_TTL_MS) return cached;
  const clientId = await deps.getClientId(providerConfigId);
  const config = resolveGateConfig(clientId ? await deps.getConfigRow(clientId) : null);
  clientCache.set(providerConfigId, { clientId, config, at: deps.now() });
  return { clientId, config };
}

function toRuleInput(event: AtlasEvent): JunkRuleInput {
  const u = event.user_data;
  return {
    email: u.email,
    phone: u.phone,
    firstName: u.first_name,
    lastName: u.last_name,
    country: u.country,
    userAgent: u.client_user_agent,
  };
}

async function runInner(event: AtlasEvent, providerConfig: CAPIProviderConfig, deps: GateDeps): Promise<JunkGateOutcome> {
  const { clientId, config } = await resolveClientAndConfig(providerConfig.id, deps);
  if (config.mode === 'off') return { action: 'send', evaluated: false, mode: config.mode, skipped: 'off' };
  if (!isEventInScope(event.event_name, config)) return { action: 'send', evaluated: false, mode: config.mode, skipped: 'out_of_scope' };

  const orgId = providerConfig.organization_id;
  const claim = await deps.store.claim(orgId, event.event_id);

  // Another provider call for the same Atlas event already evaluated it: reuse, and record that
  // this provider config is also bound for it. One evaluation, one record.
  if (claim.kind === 'memo') {
    const recordId = claim.memo.record_id;
    // A hold / drop with no record to attach to cannot be honoured: fail open.
    const memoAction = recordId ? (claim.memo.action ?? 'send') : 'send';
    if (recordId) {
      await deps.appendProvider(recordId, providerConfig.id).catch((err) =>
        logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Junk gate: could not append provider to record'));
      if (memoAction === 'hold') {
        await deps.bindHold(recordId, providerConfig).catch((err) =>
          logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Junk gate: could not re-clamp hold for provider'));
      }
    }
    return { action: memoAction, record_id: recordId, evaluated: true, mode: config.mode, verdict: claim.memo.verdict, hits: claim.memo.hits, memoised: true };
  }
  if (claim.kind === 'pending_timeout') {
    return { action: 'send', evaluated: false, mode: config.mode, skipped: 'pending_timeout' };
  }

  // We hold the claim: resolve the stateful signals, then evaluate once.
  const scope = `${orgId}:${clientId ?? 'org'}`;
  const input = toRuleInput(event);
  const t = config.thresholds;

  const contact = event.user_data.email ? normaliseEmailForHash(event.user_data.email)
    : event.user_data.phone ? normalisePhoneForHash(event.user_data.phone) : '';
  if (contact) {
    input.duplicateOfEventId = await deps.store.findDuplicate(scope, event.event_name, sha256(contact), event.event_id, t.duplicate_window_minutes);
  }
  if (event.user_data.client_ip_address) {
    input.submissionsFromIp = await deps.store.countVelocity(scope, event.event_name, sha256(event.user_data.client_ip_address.trim()), t.velocity_window_minutes);
  }

  // C3: browser-side signals. Event-level first (identity-config honeypot mapping), then the
  // GTM Signal Tag beacon keyed by the same event id. A missing beacon (it can lose a race with
  // /process, or the client has no Signal Tag) just means the two capture rules cannot fire.
  if (event.junk_signals?.honeypot_filled === true) input.honeypotFilled = true;
  const beacon = await deps.store.getBeaconSignals(orgId, event.event_id).catch(() => null);
  if (beacon) {
    if (beacon.honeypot_filled === true) input.honeypotFilled = true;
    if (typeof beacon.ms_to_submit === 'number') input.msToSubmit = beacon.ms_to_submit;
  }

  const { verdict, hits } = evaluateJunkRules(input, config);

  // What enforce mode wants done with this verdict. Observe / off / clean never act.
  let action: 'send' | 'hold' | 'drop' = 'send';
  if (config.mode === 'enforce' && verdict !== 'clean') {
    action = verdict === 'junk' ? config.action_junk : config.action_suspect;
  }

  const timeout = clampHoldTimeout(config.hold_timeout_hours, [providerConfig.provider]);
  let recordId: string | null = null;
  const expiresAt = new Date(deps.now() + timeout.hours * 3_600_000).toISOString();
  try {
    const rec = await deps.insertRecord({
      organization_id: orgId,
      client_id: clientId,
      atlas_event_id: event.event_id,
      event_name: event.event_name,
      event_time: new Date(event.event_time * 1000).toISOString(),
      provider_config_id: providerConfig.id,
      verdict,
      rule_hits: hits,
      ...(action === 'hold' ? {
        status: 'held' as const,
        expires_at: expiresAt,
        delivery_class: classifyDelivery([providerConfig.provider]),
        timeout_hours_applied: timeout.hours,
        timeout_clamped: timeout.clamped,
      } : action === 'drop' ? { status: 'rejected' as const } : {}),
    });
    recordId = rec?.id ?? null;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Junk gate: could not record verdict (delivery unaffected)');
  }
  // No record means nothing a reviewer could ever release: send instead of silently losing it.
  if (action !== 'send' && !recordId) action = 'send';

  const memo: VerdictMemo = { verdict, hits, record_id: recordId, action };
  await deps.store.saveMemo(orgId, event.event_id, memo);

  if (verdict !== 'clean') {
    // Rule ids + counts only — never the contact data the rules looked at.
    logger.info({ event_name: event.event_name, verdict, rules: hits.map((h) => h.rule_id), mode: config.mode, action }, 'Junk gate verdict');
  }
  return { action, record_id: recordId, expires_at: action === 'hold' ? expiresAt : null, evaluated: true, mode: config.mode, verdict, hits };
}

/** Never throws, never takes longer than GATE_TIMEOUT_MS, never changes what is sent (C1). */
export async function runJunkGate(
  event: AtlasEvent,
  providerConfig: CAPIProviderConfig,
  deps: GateDeps = defaultDeps(),
  timeoutMs: number = GATE_TIMEOUT_MS,
): Promise<JunkGateOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<JunkGateOutcome>((resolve) => {
      timer = setTimeout(() => resolve({ action: 'send', evaluated: false, mode: 'observe', skipped: 'timeout' }), timeoutMs);
    });
    return await Promise.race([runInner(event, providerConfig, deps), timeout]);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Junk gate failed — failing open');
    return { action: 'send', evaluated: false, mode: 'observe', skipped: 'error' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
