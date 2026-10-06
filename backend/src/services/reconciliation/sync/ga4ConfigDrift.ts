/**
 * GA4 config drift (GA4 Admin / L11 / Junk Gate PRD §A.5). Pure: diffs two
 * consecutive snapshots of one property and decides which changes also count as
 * a client-scoped tracking discontinuity.
 *
 * Only sections observed in BOTH snapshots are compared — a section that is
 * `null` (not observed) on either side is never read as a change, so an
 * unavailable v1alpha read cannot manufacture drift.
 */
import type { Ga4ConfigSnapshot } from './ga4ConfigSync';
import type { ClientDiscontinuityRow } from '@/services/google/googleTagDiscontinuities';

export type Ga4ChangeType =
  | 'stream_ids'
  | 'enhanced_form_interactions'
  | 'enhanced_stream_enabled'
  | 'ads_links'
  | 'currency'
  | 'time_zone';

export interface Ga4ConfigChange {
  type: Ga4ChangeType;
  detail: string;
}

/** Changes that alter how data is collected → recorded as client_tracking_change (PRD §A.5). */
export const DISCONTINUITY_CHANGE_TYPES: ReadonlySet<Ga4ChangeType> = new Set<Ga4ChangeType>([
  'stream_ids',
  'enhanced_form_interactions',
  'currency',
]);

const DISCONTINUITY_TITLES: Partial<Record<Ga4ChangeType, { title: string; description: string }>> = {
  stream_ids: {
    title: 'GA4 stream measurement ID changed',
    description: 'The set of GA4 web stream measurement IDs on the property changed; data is collected under a different ID from this date',
  },
  enhanced_form_interactions: {
    title: 'GA4 enhanced measurement form interactions changed',
    description: 'GA4 enhanced measurement form interaction events were switched on or off; automatic form events change from this date',
  },
  currency: {
    title: 'GA4 property currency changed',
    description: 'The GA4 property currency changed; monetary values are reported in a different currency from this date',
  },
};

const sameSet = (a: string[], b: string[]): boolean => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

export function diffGa4Snapshots(prev: Ga4ConfigSnapshot, next: Ga4ConfigSnapshot): Ga4ConfigChange[] {
  const out: Ga4ConfigChange[] = [];

  const ids = (s: Ga4ConfigSnapshot) => s.web_streams.map((w) => w.measurement_id).filter((x): x is string => !!x);
  if (!sameSet(ids(prev), ids(next))) {
    out.push({ type: 'stream_ids', detail: `${ids(prev).join(', ') || 'none'} → ${ids(next).join(', ') || 'none'}` });
  }

  for (const n of next.web_streams) {
    const p = prev.web_streams.find((w) => w.stream_id === n.stream_id);
    if (!p?.enhanced_measurement || !n.enhanced_measurement) continue;
    if (p.enhanced_measurement.form_interactions_enabled !== n.enhanced_measurement.form_interactions_enabled) {
      out.push({ type: 'enhanced_form_interactions', detail: `stream ${n.stream_id}: form interactions ${n.enhanced_measurement.form_interactions_enabled ? 'on' : 'off'}` });
    }
    if (p.enhanced_measurement.stream_enabled !== n.enhanced_measurement.stream_enabled) {
      out.push({ type: 'enhanced_stream_enabled', detail: `stream ${n.stream_id}: enhanced measurement ${n.enhanced_measurement.stream_enabled ? 'on' : 'off'}` });
    }
  }

  if (prev.ads_links && next.ads_links) {
    const a = prev.ads_links.map((l) => l.customer_id);
    const b = next.ads_links.map((l) => l.customer_id);
    if (!sameSet(a, b)) out.push({ type: 'ads_links', detail: `${a.join(', ') || 'none'} → ${b.join(', ') || 'none'}` });
  }

  if (prev.currency_code && next.currency_code && prev.currency_code !== next.currency_code) {
    out.push({ type: 'currency', detail: `${prev.currency_code} → ${next.currency_code}` });
  }
  if (prev.time_zone && next.time_zone && prev.time_zone !== next.time_zone) {
    out.push({ type: 'time_zone', detail: `${prev.time_zone} → ${next.time_zone}` });
  }
  return out;
}

export function buildGa4DiscontinuityRows(args: {
  organizationId: string;
  clientId: string;
  changes: Ga4ConfigChange[];
  effectiveDate: string;
}): ClientDiscontinuityRow[] {
  const seen = new Set<Ga4ChangeType>();
  const rows: ClientDiscontinuityRow[] = [];
  for (const c of args.changes) {
    if (!DISCONTINUITY_CHANGE_TYPES.has(c.type) || seen.has(c.type)) continue;
    seen.add(c.type);
    const meta = DISCONTINUITY_TITLES[c.type];
    if (!meta) continue;
    rows.push({
      platform: 'ga4',
      title: meta.title,
      effective_date: args.effectiveDate,
      description: meta.description,
      kind: 'client_tracking_change',
      client_id: args.clientId,
      organization_id: args.organizationId,
    });
  }
  return rows;
}
