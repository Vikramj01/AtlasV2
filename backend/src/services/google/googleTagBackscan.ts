/**
 * Google Tag Topology PRD §6.6 — one-off back-scan of existing clients after
 * Sprints 1–3. Pure: takes already-loaded data, returns three groups for an
 * INTERNAL list (D4: client comms are an operator decision per account).
 *
 *   1. Containers Atlas generated with a Google Ads destination but no sitewide
 *      Ads Google tag and no Conversion Linker (the generator defect, PRD §1.3 #1).
 *   2. Clients whose container has an Ads/Floodlight `googtag`, i.e. the ones the
 *      pre-Sprint-1 type-based rules misjudged, with which false finding(s) the
 *      old logic would have raised (to retract from any open report/action list).
 *   3. Clients whose known topology is COMBINED / COMBINED_ADS_PRIMARY.
 */
import type { GTMContainerSnapshot, GTMTag } from '@/types/audit';
import { classifyGoogleTag } from './googleTagClassifier';
import { computeTopologyVerdict, type TopologyRow, type TopologyVerdict } from './googleTagTopology';

export interface BackscanClient {
  client_id: string;
  container: GTMContainerSnapshot;
  topology_rows: TopologyRow[];
  secondary_domains: string[];
  sgtm_verified: boolean;
}

export interface BackscanResult {
  missing_ads_tag_and_linker: Array<{ client_id: string }>;
  retract_false_findings: Array<{ client_id: string; old_findings: string[] }>;
  combined: Array<{ client_id: string; verdict: TopologyVerdict; strength: string }>;
}

/** Heuristic: Atlas's own generator always emits these named consent tags. */
export function looksAtlasGenerated(container: GTMContainerSnapshot): boolean {
  return container.tags.some((t) => (t.name ?? '').startsWith('Atlas - Consent Mode v2'));
}

function paramValue(tag: GTMTag, key: string): string | undefined {
  return tag.parameter?.find((p) => p.key === key)?.value;
}

function hasAdsDestination(c: GTMContainerSnapshot): boolean {
  if (c.tags.some((t) => t.type === 'awct' || t.type === 'asp' || t.type === 'sp')) return true;
  return c.variables.some((v) => v.type === 'c' && /^AW-/i.test(v.parameter?.find((p) => p.key === 'value')?.value?.trim() ?? ''));
}

export function runBackscan(clients: BackscanClient[]): BackscanResult {
  const result: BackscanResult = { missing_ads_tag_and_linker: [], retract_false_findings: [], combined: [] };

  for (const c of clients) {
    const { container } = c;
    const googTags = container.tags.filter((t) => t.type === 'googtag');
    const adsTags = googTags.filter((t) => {
      const k = classifyGoogleTag(t, container).kind;
      return k === 'google_ads' || k === 'floodlight';
    });
    const hasAdsGoogleTag = adsTags.some((t) => classifyGoogleTag(t, container).kind === 'google_ads');
    const hasLinker = container.tags.some((t) => t.type === 'gclidw');

    if (looksAtlasGenerated(container) && hasAdsDestination(container) && !hasAdsGoogleTag && !hasLinker) {
      result.missing_ads_tag_and_linker.push({ client_id: c.client_id });
    }

    // What the old type-based rules (googtag === GA4) would have wrongly raised.
    const old: string[] = [];
    for (const t of adsTags) {
      const linked = t.parameter?.some((p) => p.key === 'linked_domains' && (p.list?.length ?? 0) > 0) ?? false;
      if (c.secondary_domains.length > 0 && !linked) old.push('GA4_CROSS_DOMAIN_LINKING_MISSING');
      if (c.sgtm_verified && paramValue(t, 'enableSendToServerContainer') !== 'true') old.push('SGTM_ROUTING_NOT_CONFIGURED');
      const types = t.consentSettings?.consentType ?? [];
      if (t.consentSettings && t.consentSettings.consentStatus !== 'NOT_SET' && !types.includes('analytics_storage')) {
        old.push('CONSENT_TYPE_MISMATCH');
      }
    }
    if (old.length > 0) result.retract_false_findings.push({ client_id: c.client_id, old_findings: [...new Set(old)] });

    const verdict = computeTopologyVerdict(c.topology_rows);
    if (verdict.verdict === 'COMBINED' || verdict.verdict === 'COMBINED_ADS_PRIMARY') {
      result.combined.push({ client_id: c.client_id, verdict: verdict.verdict, strength: verdict.strength });
    }
  }
  return result;
}
