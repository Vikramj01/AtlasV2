/**
 * GA4 Admin configuration diff (GA4 Admin / L11 / Junk Gate PRD §A.4). Reads
 * the client's latest `ga4_config_snapshots` row and compares it against what
 * Atlas knows about the client — its GTM container (connected, else generated),
 * its domains, its connected Google Ads account, its deployed signals and its
 * Journey Builder conversion stages — then writes findings through
 * `findingWriter`.
 *
 * A finding needs a client association, so this only runs for a client with an
 * active GA4 connection AND a snapshot. No snapshot / no connection = no
 * finding (never an absence claim). Loader steps for optional context degrade
 * to "not known" (null/empty), which makes the dependent rule not fire.
 */
import { supabaseAdmin } from '@/services/database/supabase';
import { parseContainerJson } from '@/services/gtm/containerParser';
import { classifyGoogleTag } from '@/services/google/googleTagClassifier';
import { ACTION_PRIMITIVES } from '@/services/journey/actionPrimitives';
import { writeFinding } from './findingWriter';
import { evaluateGa4ConfigRules, normaliseHost, type Ga4RuleInput } from './ga4ConfigRules';
import { buildNarrative, buildRemediation, getDimension, getSeverity } from '../codes/findingCodes';
import type { Ga4ConfigSnapshot } from '../sync/ga4ConfigSync';
import type { GTMContainerSnapshot } from '@/types/audit';
import logger from '@/utils/logger';

// ── Pure helpers ──────────────────────────────────────────────────────────────

/** Resolved `G-…` measurement IDs of every GA4 Google tag in a container. Unresolvable IDs are skipped, never guessed. */
export function ga4MeasurementIdsFromContainer(container: GTMContainerSnapshot): string[] {
  const ids = new Set<string>();
  for (const tag of container.tags) {
    if (tag.type !== 'googtag' && tag.type !== 'gaawc') continue;
    const c = classifyGoogleTag(tag, { variables: container.variables });
    if (c.kind !== 'ga4') continue;
    // gaawc stores the ID under measurementId; classifyGoogleTag only marks it GA4.
    const id = c.resolvedTagId ?? tag.parameter?.find((p) => p.key === 'measurementId')?.value;
    if (id && /^G-[A-Z0-9]+$/i.test(id.trim())) ids.add(id.trim().toUpperCase());
  }
  return [...ids];
}

/** GA4 event names of every Journey Builder action in the conversion category. */
export function conversionGa4EventsFromStageActions(stageActions: string[][]): string[] {
  const events = new Set<string>();
  for (const actions of stageActions) {
    for (const key of actions) {
      const primitive = ACTION_PRIMITIVES.find((p) => p.key === key);
      if (primitive?.category !== 'conversion') continue;
      const ga4 = primitive.platform_mappings.find((m) => m.platform === 'ga4');
      if (ga4) events.add(ga4.event_name);
    }
  }
  return [...events];
}

const digits = (s: string): string => s.replace(/\D/g, '');

// ── Loader ────────────────────────────────────────────────────────────────────

async function safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    logger.warn({ label, err: err instanceof Error ? err.message : String(err) }, 'GA4 config diff: context load failed — treated as not known');
    return fallback;
  }
}

export async function loadGa4RuleInputs(clientId: string, orgId: string): Promise<Ga4RuleInput | null> {
  const { data: conns } = await supabaseAdmin
    .from('platform_connections')
    .select('id, account_id, last_synced_at')
    .eq('client_id', clientId)
    .eq('platform', 'ga4')
    .eq('status', 'active')
    .limit(1);
  const ga4 = (conns as Array<{ id: string; account_id: string; last_synced_at: string | null }> | null)?.[0];
  if (!ga4) return null;

  const { data: snapRow } = await supabaseAdmin
    .from('ga4_config_snapshots')
    .select('snapshot')
    .eq('organization_id', orgId)
    .eq('property_id', ga4.account_id)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!snapRow) return null;
  const snapshot = (snapRow as { snapshot: Ga4ConfigSnapshot }).snapshot;

  const containerMeasurementIds = await safe('container', async () => {
    const { data: gtmConn } = await supabaseAdmin
      .from('gtm_container_connections').select('id').eq('client_id', clientId).limit(1);
    const connId = (gtmConn as Array<{ id: string }> | null)?.[0]?.id;
    if (connId) {
      const { data: snaps } = await supabaseAdmin
        .from('gtm_container_snapshots').select('container_json').eq('connection_id', connId)
        .order('snapshot_at', { ascending: false }).limit(1);
      const json = (snaps as Array<{ container_json: unknown }> | null)?.[0]?.container_json;
      if (json) return ga4MeasurementIdsFromContainer(parseContainerJson(json, 'gtm_api'));
    }
    // No connected container: fall back to the latest Atlas-generated one.
    const { data: outputs } = await supabaseAdmin
      .from('client_outputs').select('output_data').eq('client_id', clientId).eq('output_type', 'gtm_container')
      .order('generated_at', { ascending: false }).limit(1);
    const generated = (outputs as Array<{ output_data: unknown }> | null)?.[0]?.output_data;
    return generated ? ga4MeasurementIdsFromContainer(parseContainerJson(generated, 'manual_upload')) : null;
  }, null as string[] | null);

  const client = await safe('client', async () => {
    const { data } = await supabaseAdmin.from('clients').select('website_url, secondary_domains').eq('id', clientId).maybeSingle();
    return data as { website_url: string | null; secondary_domains: string[] | null } | null;
  }, null);
  const clientHosts = [...new Set(
    [client?.website_url, ...(client?.secondary_domains ?? [])].filter((x): x is string => !!x).map(normaliseHost).filter(Boolean),
  )];

  const ads = await safe('ads', async () => {
    const { data } = await supabaseAdmin
      .from('platform_connections').select('account_id, parent_connection_id, metadata')
      .eq('client_id', clientId).eq('platform', 'google_ads').eq('status', 'active');
    const rows = (data ?? []) as Array<{ account_id: string; parent_connection_id: string | null; metadata: Record<string, unknown> | null }>;
    const managerIds: string[] = [];
    const parents = rows.map((r) => r.parent_connection_id).filter((x): x is string => !!x);
    if (parents.length > 0) {
      const { data: pr } = await supabaseAdmin.from('platform_connections').select('account_id').in('id', parents);
      for (const p of (pr ?? []) as Array<{ account_id: string }>) managerIds.push(digits(p.account_id));
    }
    const settings = rows
      .map((r) => r.metadata?.ads_customer as { currency_code?: string | null; time_zone?: string | null } | undefined)
      .find((m) => !!m);
    return {
      ids: rows.map((r) => digits(r.account_id)),
      managerIds,
      customer: settings ? { currency_code: settings.currency_code ?? null, time_zone: settings.time_zone ?? null } : null,
    };
  }, { ids: [] as string[], managerIds: [] as string[], customer: null as Ga4RuleInput['adsCustomer'] });

  // Journey conversion stages for this client.
  const conversionEvents = await safe('journeys', async () => {
    const { data: journeys } = await supabaseAdmin.from('journeys').select('id').eq('client_id', clientId);
    const ids = ((journeys ?? []) as Array<{ id: string }>).map((j) => j.id);
    if (ids.length === 0) return [] as string[];
    const { data: stages } = await supabaseAdmin.from('journey_stages').select('actions').in('journey_id', ids);
    return conversionGa4EventsFromStageActions(((stages ?? []) as Array<{ actions: string[] | null }>).map((s) => s.actions ?? []));
  }, [] as string[]);

  // GA4 events of signals deployed to this client.
  const deployedEvents = await safe('signals', async () => {
    const { data: deployments } = await supabaseAdmin.from('deployments').select('pack_id').eq('client_id', clientId);
    const packIds = ((deployments ?? []) as Array<{ pack_id: string }>).map((d) => d.pack_id);
    if (packIds.length === 0) return [] as string[];
    const { data: links } = await supabaseAdmin.from('signal_pack_signals').select('signal_id').in('pack_id', packIds);
    const signalIds = ((links ?? []) as Array<{ signal_id: string }>).map((l) => l.signal_id);
    if (signalIds.length === 0) return [] as string[];
    const { data: signals } = await supabaseAdmin.from('signals').select('platform_mappings').in('id', signalIds);
    return ((signals ?? []) as Array<{ platform_mappings: Record<string, { event_name?: string }> | null }>)
      .map((s) => s.platform_mappings?.ga4?.event_name)
      .filter((e): e is string => !!e);
  }, [] as string[]);

  // Key events: only meaningful once the key-event sync has completed for this connection.
  const keyEventNames = ga4.last_synced_at
    ? await safe('key_events', async () => {
        const { data } = await supabaseAdmin
          .from('platform_conversion_actions').select('name').eq('connection_id', ga4.id).eq('status', 'ACTIVE');
        return ((data ?? []) as Array<{ name: string }>).map((r) => r.name);
      }, null as string[] | null)
    : null;

  return {
    snapshot,
    containerMeasurementIds,
    clientHosts,
    adsCustomerIds: ads.ids,
    adsManagerIds: ads.managerIds,
    adsCustomer: ads.customer,
    leadSignalEvents: [...conversionEvents, ...deployedEvents],
    conversionEvents,
    keyEventNames,
  };
}

// ── Run ───────────────────────────────────────────────────────────────────────

export async function runGa4ConfigDiff(runId: string, clientId: string, orgId: string): Promise<void> {
  const input = await loadGa4RuleInputs(clientId, orgId);
  if (!input) return;

  const findings = evaluateGa4ConfigRules(input);
  for (const f of findings) {
    await writeFinding({
      runId,
      organizationId: orgId,
      clientId,
      platform: 'ga4',
      dimension: getDimension(f.code),
      severity: getSeverity(f.code),
      findingCode: f.code,
      expected: f.expected,
      observed: f.observed,
      narrative: buildNarrative(f.code, f.context),
      remediationHint: buildRemediation(f.code, f.context),
    });
  }
  logger.info({ runId, clientId, count: findings.length }, 'GA4 config diff complete');
}
