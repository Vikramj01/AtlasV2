/**
 * Google Tag Topology PRD §6 (Sprint 3) — which destinations share a Google
 * tag ("combined") versus each have their own ("split").
 *
 * Combination lives in Google's tag admin layer, not in GTM container JSON, so
 * it can only be learned from (in descending strength): operator declaration
 * of a client-confirmed fact, runtime network observation, or (for Atlas's
 * own spike, PRD §17 U8) a GTM API grouping that is not built.
 *
 * Pure: no I/O. Rows are what `google_tag_topology` stores.
 *
 * Co-occurrence (a destination ID seen in outbound hits while no loaded tag
 * carries that ID) is a HINT, never proof: it yields a COMBINED verdict with
 * strength 'assumed', never anything stronger (PRD acceptance criterion 9).
 */
import { kindFromGoogleId, type GoogleDestinationKind } from './googleTagClassifier';

export type TopologySource = 'gtm_api' | 'runtime_observed' | 'operator_declared';
export type TopologyVerdict = 'SPLIT' | 'COMBINED' | 'COMBINED_ADS_PRIMARY' | 'UNKNOWN';
/** How strongly the verdict is established. Only 'declared'/'observed' may be shown without a "needs confirmation" qualifier. */
export type TopologyStrength = 'declared' | 'observed' | 'assumed' | 'none';

export interface TopologyRow {
  google_tag_id: string;
  primary_destination_id: string | null;
  destination_ids: string[];
  source: TopologySource;
  /** 'CLIENT_CONFIRMED' | 'OPERATOR_ASSUMED' — only for operator_declared rows. */
  declaration_source?: 'CLIENT_CONFIRMED' | 'OPERATOR_ASSUMED' | null;
  /** True for a runtime row built from co-occurrence rather than self-attribution. */
  inferred?: boolean;
}

export interface TopologyVerdictResult {
  verdict: TopologyVerdict;
  strength: TopologyStrength;
  /** The tags that carry more than one destination (empty unless COMBINED*). */
  combined_tags: Array<{ google_tag_id: string; primary_destination_id: string | null; destination_ids: string[] }>;
  /** Number of distinct destination IDs the verdict was computed over. */
  destination_count: number;
}

// ── Runtime observation extraction ────────────────────────────────────────────

export interface RequestLike {
  url: string;
}

export interface GoogleTagObservation {
  /** Google tag IDs loaded via gtag/js?id= (G-/AW-/GT-/DC-). */
  loaded_tag_ids: string[];
  /** Destination IDs seen as the target of outbound Google measurement hits. */
  destination_ids: string[];
  /** Destinations whose hit target equals a loaded tag's own ID — safely attributable. */
  attributed: Array<{ loaded_tag_id: string; destination_id: string }>;
  /** Destinations seen in hits with no loaded tag carrying that ID. Cannot be attributed. */
  unattributed_destination_ids: string[];
}

const GTAG_JS = /googletagmanager\.com\/gtag\/js/i;

function tryUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** Destination ID a single outbound Google hit targets, or null. */
export function destinationOfHit(rawUrl: string): string | null {
  const u = tryUrl(rawUrl);
  if (!u) return null;
  const host = u.hostname.toLowerCase();
  const path = u.pathname;

  // GA4 collect: tid=G-XXXX
  if ((host.endsWith('google-analytics.com') || host === 'analytics.google.com') && /\/g\/collect/.test(path)) {
    const tid = u.searchParams.get('tid');
    return tid && kindFromGoogleId(tid) === 'ga4' ? tid : null;
  }

  // Google Ads conversion / view-through / remarketing: .../pagead/(conversion|viewthroughconversion|1p-conversion|1p-user-list)/<AW-ID digits>
  if (host.endsWith('googleadservices.com') || host.endsWith('doubleclick.net') || host.endsWith('google.com')) {
    const m = /\/pagead\/(?:1p-)?(?:conversion|viewthroughconversion|user-list)\/(\d{6,})/.exec(path);
    if (m) return `AW-${m[1]}`;
  }
  return null;
}

export function extractGoogleTagObservation(requests: RequestLike[]): GoogleTagObservation {
  const loaded = new Set<string>();
  const destinations = new Set<string>();

  for (const r of requests) {
    if (GTAG_JS.test(r.url)) {
      const id = tryUrl(r.url)?.searchParams.get('id');
      if (id && kindFromGoogleId(id) !== 'unknown') loaded.add(id);
      continue;
    }
    const dest = destinationOfHit(r.url);
    if (dest) destinations.add(dest);
  }

  const loaded_tag_ids = [...loaded];
  const destination_ids = [...destinations];
  const attributed = destination_ids
    .filter((d) => loaded.has(d))
    .map((d) => ({ loaded_tag_id: d, destination_id: d }));
  const unattributed_destination_ids = destination_ids.filter((d) => !loaded.has(d));

  return { loaded_tag_ids, destination_ids, attributed, unattributed_destination_ids };
}

/**
 * Turns an observation into `runtime_observed` topology rows.
 *
 * - Every loaded tag with a self-attributed destination becomes a row for that
 *   tag with only itself as a destination (direct evidence of a per-destination tag).
 * - Unattributed destinations can't be assigned to a tag. When exactly one
 *   Google tag is loaded they are recorded against it as an INFERRED
 *   co-occurrence (strength 'assumed'); with several loaded tags the hit is
 *   unattributable and is not recorded at all (PRD §6.3: never infer grouping
 *   from co-occurrence alone when attribution is ambiguous).
 */
export function observationToRows(obs: GoogleTagObservation): TopologyRow[] {
  const rows: TopologyRow[] = [];

  for (const tagId of obs.loaded_tag_ids) {
    const destination_ids = [tagId];
    const row: TopologyRow = {
      google_tag_id: tagId,
      primary_destination_id: tagId,
      destination_ids,
      source: 'runtime_observed',
    };
    if (obs.loaded_tag_ids.length === 1 && obs.unattributed_destination_ids.length > 0) {
      row.destination_ids = [tagId, ...obs.unattributed_destination_ids];
      row.inferred = true;
    }
    rows.push(row);
  }
  return rows;
}

// ── Verdict ───────────────────────────────────────────────────────────────────

function kindOf(id: string | null): GoogleDestinationKind {
  return id ? kindFromGoogleId(id) : 'unknown';
}

function evaluate(rows: TopologyRow[]): Omit<TopologyVerdictResult, 'strength'> & { anyInferred: boolean } {
  const combined = rows.filter((r) => new Set(r.destination_ids).size > 1);
  const allDestinations = new Set(rows.flatMap((r) => r.destination_ids));
  const adsPrimary = combined.some((r) => {
    const k = kindOf(r.primary_destination_id);
    return (k === 'google_ads' || k === 'floodlight') && r.destination_ids.some((d) => kindFromGoogleId(d) === 'ga4');
  });
  return {
    verdict: combined.length === 0 ? 'SPLIT' : adsPrimary ? 'COMBINED_ADS_PRIMARY' : 'COMBINED',
    combined_tags: combined.map((r) => ({
      google_tag_id: r.google_tag_id,
      primary_destination_id: r.primary_destination_id,
      destination_ids: [...new Set(r.destination_ids)],
    })),
    destination_count: allDestinations.size,
    anyInferred: combined.some((r) => r.inferred),
  };
}

/**
 * Computes the per-client verdict from the CURRENT rows of every source.
 * An operator declaration outranks runtime evidence; between the two, the
 * declaration decides. With no rows: UNKNOWN.
 */
export function computeTopologyVerdict(rows: TopologyRow[]): TopologyVerdictResult {
  if (rows.length === 0) {
    return { verdict: 'UNKNOWN', strength: 'none', combined_tags: [], destination_count: 0 };
  }

  const declared = rows.filter((r) => r.source === 'operator_declared');
  if (declared.length > 0) {
    const e = evaluate(declared);
    const confirmed = declared.every((r) => r.declaration_source === 'CLIENT_CONFIRMED');
    return {
      verdict: e.verdict,
      combined_tags: e.combined_tags,
      destination_count: e.destination_count,
      strength: confirmed ? 'declared' : 'assumed',
    };
  }

  const runtime = rows.filter((r) => r.source === 'runtime_observed' || r.source === 'gtm_api');
  const e = evaluate(runtime);
  // Absence of observed combination is not proof of a split when there is
  // nothing to be combined with: a single destination is trivially uncombined.
  if (e.verdict === 'SPLIT') {
    return {
      verdict: 'SPLIT',
      combined_tags: [],
      destination_count: e.destination_count,
      strength: 'observed',
    };
  }
  return {
    verdict: e.verdict,
    combined_tags: e.combined_tags,
    destination_count: e.destination_count,
    // Runtime combination built only from co-occurrence never exceeds 'assumed'.
    strength: e.anyInferred ? 'assumed' : 'observed',
  };
}
