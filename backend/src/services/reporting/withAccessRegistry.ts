/**
 * With-access registry (Pre-Connection Scan Confidence Tiering PRD §12).
 *
 * A dedicated report section, populated from this static registry rather
 * than written by hand per report — every entry names a connected-tier
 * check that references a real, already-shipped Atlas module (PRD §12.1:
 * "No aspirational checks"), and only renders when it actually resolves a
 * finding or open question raised *in this run* (§12.1: "An entry
 * resolving nothing in this run is omitted").
 *
 * Each entry's `check` corresponds to a real Atlas feature per CLAUDE.md:
 *  - Platform Reconciliation (`/api/reconciliation`, `services/reconciliation/`).
 *  - Realtime CAPI's dedup/delivery pipeline (`services/capi/`, `dedupStore.ts`)
 *    plus Server-Side GTM Detection & Monitoring (`services/dqm/sgtmProbe.ts`).
 *  - Signal Enrichment Configuration's composite match/enrichment score
 *    (`services/enrichment/enrichmentConfigService.ts`).
 *  - Platform Reconciliation's volume/delivery diffing, applied to
 *    attribution-window-sensitive click-ID persistence specifically.
 *
 * `answers_question_for` is narrowed at build time (see
 * buildWithAccessSection below) to only the rule_ids this specific run
 * actually raised — so a report never claims a connected check would
 * resolve something that isn't actually a finding here.
 */
import type { ReportJSON, WithAccessEntry } from '@/types/audit';

const REGISTRY: WithAccessEntry[] = [
  {
    check: 'Platform reconciliation',
    requires_connection: ['google_ads', 'meta', 'tiktok'],
    answers_question_for: ['DECLARED_PLATFORM_HAS_TAG', 'UNDECLARED_PLATFORM_TAG_DETECTED'],
    reveals: 'Whether platform-reported conversions match what this scan observed on the site — config, volume, and delivery diffs against each connected ad account, with per-client tolerance.',
  },
  {
    check: 'CAPI delivery and dedup audit',
    requires_connection: ['meta', 'tiktok'],
    answers_question_for: ['EVENT_ID_CONSISTENT_CLIENT_TO_SERVER', 'EVENT_ID_FORWARDED_TO_PLATFORM_REQUESTS', 'SERVER_SIDE_GTM_CONNECTION_VERIFIED', 'VERIFIED_SGTM_TRAFFIC_OBSERVED'],
    reveals: 'Whether events actually arrive server-side and deduplicate correctly against browser events, with real delivery and match-rate telemetry rather than a heuristic hostname guess.',
  },
  {
    check: 'Match rate and identity enrichment score',
    requires_connection: ['meta', 'google_ads'],
    answers_question_for: ['PHONE_CAPTURED_WHERE_COLLECTED', 'NAME_AND_ADDRESS_CAPTURED_WHERE_COLLECTED', 'EXTERNAL_ID_SET', 'HASHED_WITH_SHA256'],
    reveals: 'Identity match quality on current live traffic — the composite 0-100 enrichment score and per-identifier match rate, not just whether a field is present in the payload.',
  },
  {
    check: 'Attribution window integrity',
    requires_connection: ['google_ads'],
    answers_question_for: ['STORAGE_LIFETIME_MEETS_ATTRIBUTION_WINDOW'],
    reveals: "Whether the click-ID storage lifetime this scan measured actually supports the attribution window configured in the connected ad account.",
  },
];

function raisedRuleIds(report: ReportJSON): Set<string> {
  const ids = new Set<string>();
  for (const issue of report.issues) ids.add(issue.rule_id);
  for (const finding of report.could_not_be_assessed ?? []) ids.add(finding.rule_id);
  return ids;
}

/**
 * Filters the static registry down to entries with something real to
 * resolve in this run, and each entry's own `answers_question_for` down to
 * just the rule_ids this run actually raised — so the rendered section
 * never over-claims. Returns undefined (not an empty array) when nothing
 * applies, matching could_not_be_assessed/signal_conflicts' convention.
 */
export function buildWithAccessSection(report: ReportJSON): WithAccessEntry[] | undefined {
  const raised = raisedRuleIds(report);

  const entries = REGISTRY
    .map((entry) => ({ ...entry, answers_question_for: entry.answers_question_for.filter((ruleId) => raised.has(ruleId)) }))
    .filter((entry) => entry.answers_question_for.length > 0);

  return entries.length > 0 ? entries : undefined;
}
