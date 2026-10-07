/**
 * The junk conversion gate (GA4 Admin / L11 / Junk Gate PRD Part C). C1: observe mode only.
 *
 * Placement (PRD §C.4, decided in Sprint 0.3): in `processEvent()` after enrichment and the
 * consent gate, before dedup. The gate therefore only ever sees events that passed consent, so
 * the IP/UA it reads add no processing beyond what consent already allows for delivery.
 * `processServerSourcedEvent()` (Shopify, outcomes) does not call it — out of scope (§C.4).
 *
 * C1 NEVER delays, blocks or alters an event: every outcome has `action: 'send'`. A client whose
 * saved mode is `enforce` is evaluated and recorded exactly as `observe` until C2 ships holds.
 * The gate also fails OPEN: any error or a timeout leaves delivery untouched (today's behaviour).
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
import {
  createDefaultStore, sha256, normaliseEmailForHash, normalisePhoneForHash, type JunkGateStore, type VerdictMemo,
} from './store';
import type { JunkGateConfig, JunkRuleInput, JunkVerdict, RuleHit } from './types';
import {
  getClientIdForProvider, getJunkGateConfigRow, insertObservedRecord, appendProviderConfigId,
} from '@/services/database/junkGateQueries';
import logger from '@/utils/logger';

export const GATE_TIMEOUT_MS = 1500;
const CLIENT_CACHE_TTL_MS = 60_000;

export interface JunkGateOutcome {
  /** C1: always 'send'. */
  action: 'send';
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
  now: () => number;
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
    if (claim.memo.record_id) {
      await deps.appendProvider(claim.memo.record_id, providerConfig.id).catch((err) =>
        logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Junk gate: could not append provider to record'));
    }
    return { action: 'send', evaluated: true, mode: config.mode, verdict: claim.memo.verdict, hits: claim.memo.hits, memoised: true };
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

  const { verdict, hits } = evaluateJunkRules(input, config);

  let recordId: string | null = null;
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
    });
    recordId = rec?.id ?? null;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Junk gate: could not record verdict (delivery unaffected)');
  }

  const memo: VerdictMemo = { verdict, hits, record_id: recordId };
  await deps.store.saveMemo(orgId, event.event_id, memo);

  if (config.mode === 'enforce') {
    logger.info({ provider: providerConfig.provider }, 'Junk gate: enforce mode is not active until C2 — evaluated and recorded as observe');
  }
  if (verdict !== 'clean') {
    // Rule ids + counts only — never the contact data the rules looked at.
    logger.info({ event_name: event.event_name, verdict, rules: hits.map((h) => h.rule_id), mode: config.mode }, 'Junk gate verdict');
  }
  return { action: 'send', evaluated: true, mode: config.mode, verdict, hits };
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
