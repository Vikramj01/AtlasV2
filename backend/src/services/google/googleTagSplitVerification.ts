/**
 * Google Tag Topology PRD §7.4 (Sprint 4) — has a split actually happened?
 *
 * Atlas never claims verification from the draft deploy alone. A plan is
 * `verified` only when ALL of:
 *   1. a container snapshot taken AFTER the plan was deployed (the draft is
 *      unpublished, so an older snapshot cannot show the new tags);
 *   2. a topology observation taken after the deploy, whose verdict is SPLIT;
 *   3. GOOGLE_ADS_GOOGLE_TAG_MISSING passing against that snapshot.
 * Anything else returns the reasons so the operator can see what still fails.
 *
 * Pure: the route resolves the inputs and calls this.
 */
import type { AuditData, GTMContainerSnapshot } from '@/types/audit';
import { GOOGLE_ADS_GOOGLE_TAG_MISSING } from '@/services/validation/googleTagTopology';
import { computeTopologyVerdict, type TopologyRow, type TopologyVerdictResult } from './googleTagTopology';

export interface VerificationInput {
  /** When the plan's draft was deployed (or created, for a download-only plan). */
  planStartedAt: Date;
  snapshot: { snapshot_at: string; container: GTMContainerSnapshot } | null;
  /** Current topology rows, each with its observation time. */
  topologyRows: Array<TopologyRow & { observed_at: string }>;
  secondaryDomains: string[];
}

export interface VerificationResult {
  verified: boolean;
  reasons: string[];
  topology: TopologyVerdictResult;
}

export function evaluateSplitVerification(input: VerificationInput): VerificationResult {
  const reasons: string[] = [];
  const after = (iso: string) => new Date(iso).getTime() > input.planStartedAt.getTime();

  const freshRows = input.topologyRows.filter((r) => after(r.observed_at));
  const topology = computeTopologyVerdict(freshRows);

  if (freshRows.length === 0) {
    reasons.push('No Google tag topology has been observed since the draft was created. Run a scan for this client, or record a declaration, after publishing.');
  } else if (topology.verdict !== 'SPLIT') {
    reasons.push(`The latest topology observation shows ${topology.verdict}, not SPLIT.`);
  }

  if (!input.snapshot || !after(input.snapshot.snapshot_at)) {
    reasons.push('No container snapshot has been taken since the draft was created. Publish the draft in GTM, then sync the container.');
  } else {
    const ruleInput = {
      gtmContainer: input.snapshot.container,
      google_tag_topology: topology,
      client_secondary_domains: input.secondaryDomains,
    } as unknown as AuditData;
    const rule = GOOGLE_ADS_GOOGLE_TAG_MISSING.test(ruleInput);
    if (rule.status === 'fail') {
      reasons.push('The synced container still has no sitewide Google tag for the Google Ads destination.');
    }
  }

  return { verified: reasons.length === 0, reasons, topology };
}
