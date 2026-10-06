/**
 * Reconciliation sync — GA4 property configuration snapshot (GA4 Admin / L11 /
 * Junk Gate PRD Part A1). Read-only: no GA4 write scope is requested anywhere.
 *
 * Reads the property (currency, time zone), its data streams (web stream
 * measurement ID + default URI), per-stream enhanced measurement settings,
 * Google Ads links and data retention, normalises them into a non-PII
 * snapshot, and writes a `ga4_config_snapshots` row ONLY when the hash differs
 * from the property's latest row (a change log, not a poll log).
 *
 * Failure policy: the property and data-stream reads are required (throw).
 * Links, retention and enhanced measurement are optional sections — enhanced
 * measurement is `v1alpha`-only (Sprint 0), so it can break without notice. A
 * failed optional read carries the previous snapshot's value forward when one
 * exists, so a flaky read never produces a false "config changed" row or an
 * absence claim; with no previous value the section is `null` (= not observed).
 */
import { createHash } from 'crypto';
import { supabaseAdmin } from '@/services/database/supabase';
import { resolveTokens } from '@/services/connections/tokenManager';
import { ga4AdminGet } from '@/integrations/google/ga4AdminClient';
import logger from '@/utils/logger';

export interface Ga4WebStreamSnapshot {
  stream_id: string;
  measurement_id: string | null;
  default_uri: string | null;
  /** null = enhanced measurement not observed (v1alpha unavailable). */
  enhanced_measurement: {
    stream_enabled: boolean;
    form_interactions_enabled: boolean;
  } | null;
}

export interface Ga4ConfigSnapshot {
  property_id: string;
  currency_code: string | null;
  time_zone: string | null;
  web_streams: Ga4WebStreamSnapshot[];
  /** Normalised (digits-only) linked Google Ads customer IDs. null = not observed. */
  ads_links: Array<{ customer_id: string; ads_personalization_enabled: boolean }> | null;
  data_retention: { event_data_retention: string | null; user_data_retention: string | null } | null;
}

export interface Ga4ConfigSyncResult {
  changed: boolean;
  snapshot: Ga4ConfigSnapshot;
  previous: Ga4ConfigSnapshot | null;
  hash: string;
  carried_forward: string[];
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

const digitsOnly = (v: string): string => v.replace(/\D/g, '');

/** Canonical JSON (sorted keys) so the hash depends only on content. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export function hashSnapshot(snapshot: Ga4ConfigSnapshot): string {
  return createHash('sha256').update(canonicalJson(snapshot)).digest('hex');
}

// ── Normalisers (pure) ────────────────────────────────────────────────────────
// Deliberately drop timestamps (createTime/updateTime change without a config
// change) and creatorEmailAddress on Ads links (PII).

export function normaliseWebStream(
  stream: Record<string, unknown>,
  enhanced: Record<string, unknown> | null,
): Ga4WebStreamSnapshot | null {
  const web = stream.webStreamData as Record<string, unknown> | undefined;
  if (!web) return null;
  const name = str(stream.name) ?? '';
  return {
    stream_id: name.split('/').pop() ?? name,
    measurement_id: str(web.measurementId),
    default_uri: str(web.defaultUri),
    enhanced_measurement: enhanced
      ? {
          stream_enabled: enhanced.streamEnabled === true,
          form_interactions_enabled: enhanced.formInteractionsEnabled === true,
        }
      : null,
  };
}

export function normaliseAdsLinks(links: Array<Record<string, unknown>>): NonNullable<Ga4ConfigSnapshot['ads_links']> {
  return links
    .map((l) => ({
      customer_id: digitsOnly(String(l.customerId ?? '')),
      ads_personalization_enabled: l.adsPersonalizationEnabled === true,
    }))
    .filter((l) => l.customer_id.length > 0)
    .sort((a, b) => a.customer_id.localeCompare(b.customer_id));
}

export function normaliseRetention(r: Record<string, unknown>): NonNullable<Ga4ConfigSnapshot['data_retention']> {
  return { event_data_retention: str(r.eventDataRetention), user_data_retention: str(r.userDataRetention) };
}

// ── Reads ─────────────────────────────────────────────────────────────────────

async function listAll(path: string, key: string, token: string): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  let pageToken: string | undefined;
  do {
    const sep = path.includes('?') ? '&' : '?';
    const page = (await ga4AdminGet(
      `${path}${sep}pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`,
      token,
    )) as Record<string, unknown>;
    out.push(...((page[key] as Array<Record<string, unknown>> | undefined) ?? []));
    pageToken = typeof page.nextPageToken === 'string' && page.nextPageToken ? page.nextPageToken : undefined;
  } while (pageToken);
  return out;
}

async function getLatestSnapshot(
  orgId: string,
  propertyId: string,
): Promise<{ snapshot: Ga4ConfigSnapshot; snapshot_hash: string } | null> {
  const { data, error } = await supabaseAdmin
    .from('ga4_config_snapshots')
    .select('snapshot, snapshot_hash')
    .eq('organization_id', orgId)
    .eq('property_id', propertyId)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`ga4_config_snapshots read failed: ${error.message}`);
  return (data as { snapshot: Ga4ConfigSnapshot; snapshot_hash: string } | null) ?? null;
}

export async function syncGa4Config(connectionId: string, orgId: string): Promise<Ga4ConfigSyncResult | null> {
  const tokens = await resolveTokens(connectionId);
  const { data: conn } = await supabaseAdmin
    .from('platform_connections')
    .select('account_id, client_id')
    .eq('id', connectionId)
    .single();
  if (!conn) return null;

  const { account_id: propertyId, client_id: clientId } = conn as { account_id: string; client_id: string | null };
  const token = tokens.access_token;
  const previousRow = await getLatestSnapshot(orgId, propertyId);
  const previous = previousRow?.snapshot ?? null;
  const carried: string[] = [];

  // Required reads.
  const property = (await ga4AdminGet(`properties/${propertyId}`, token)) as Record<string, unknown>;
  const streams = await listAll(`properties/${propertyId}/dataStreams`, 'dataStreams', token);

  // Optional: enhanced measurement per web stream (v1alpha only).
  const webStreams: Ga4WebStreamSnapshot[] = [];
  for (const stream of streams) {
    if (!stream.webStreamData) continue;
    const name = str(stream.name) ?? '';
    const prevStream = previous?.web_streams.find((s) => s.stream_id === (name.split('/').pop() ?? name));
    let enhanced: Record<string, unknown> | null = null;
    try {
      enhanced = (await ga4AdminGet(`${name}/enhancedMeasurementSettings`, token, 'v1alpha')) as Record<string, unknown>;
    } catch (err) {
      logger.warn({ connectionId, err: (err as Error).message }, 'GA4 enhanced measurement read unavailable (v1alpha) — not observed');
    }
    const normalised = normaliseWebStream(stream, enhanced);
    if (!normalised) continue;
    if (!enhanced && prevStream?.enhanced_measurement) {
      normalised.enhanced_measurement = prevStream.enhanced_measurement;
      carried.push(`enhanced_measurement:${normalised.stream_id}`);
    }
    webStreams.push(normalised);
  }
  webStreams.sort((a, b) => a.stream_id.localeCompare(b.stream_id));

  // Optional: Ads links.
  let adsLinks: Ga4ConfigSnapshot['ads_links'] = null;
  try {
    adsLinks = normaliseAdsLinks(await listAll(`properties/${propertyId}/googleAdsLinks`, 'googleAdsLinks', token));
  } catch (err) {
    logger.warn({ connectionId, err: (err as Error).message }, 'GA4 Google Ads links read failed — not observed');
    if (previous?.ads_links) { adsLinks = previous.ads_links; carried.push('ads_links'); }
  }

  // Optional: data retention.
  let retention: Ga4ConfigSnapshot['data_retention'] = null;
  try {
    retention = normaliseRetention(
      (await ga4AdminGet(`properties/${propertyId}/dataRetentionSettings`, token)) as Record<string, unknown>,
    );
  } catch (err) {
    logger.warn({ connectionId, err: (err as Error).message }, 'GA4 data retention read failed — not observed');
    if (previous?.data_retention) { retention = previous.data_retention; carried.push('data_retention'); }
  }

  const snapshot: Ga4ConfigSnapshot = {
    property_id: propertyId,
    currency_code: str(property.currencyCode),
    time_zone: str(property.timeZone),
    web_streams: webStreams,
    ads_links: adsLinks,
    data_retention: retention,
  };
  const hash = hashSnapshot(snapshot);

  if (previousRow && previousRow.snapshot_hash === hash) {
    return { changed: false, snapshot, previous, hash, carried_forward: carried };
  }

  const { error } = await supabaseAdmin.from('ga4_config_snapshots').insert({
    organization_id: orgId,
    connection_id: connectionId,
    client_id: clientId ?? null,
    property_id: propertyId,
    snapshot,
    snapshot_hash: hash,
  });
  if (error) throw new Error(`ga4_config_snapshots insert failed: ${error.message}`);

  logger.info({ connectionId, propertyId, firstSnapshot: !previousRow }, 'GA4 config snapshot written');
  return { changed: true, snapshot, previous, hash, carried_forward: carried };
}
