/**
 * GTG status back-fill report — pure (docs/prd/google-tag-gateway.md §5.4).
 *
 * Compares what the old flag said (a GTM OAuth connection exists for the
 * client's org) with the new per-client status. Until Sprint 2's matcher can
 * derive a status from a capture, every client without one stays 'unknown',
 * which lifts any 85 cap that existed only because the old boolean was false.
 * The distribution is the evidence of how wrong the old flag was.
 */
import { normaliseGtgStatus, shouldCapScore, isGtgActive, type GtgStatus } from './gtgStatus';

export interface BackfillClientInput {
  client_id: string;
  organisation_id: string;
  /** Stored clients.gtg_status (null/undefined on a row that pre-dates the column). */
  gtg_status: unknown;
  /** Old logic: the org has at least one gtm_container_connections row. */
  org_has_gtm_connection: boolean;
}

export interface BackfillReport {
  clients: number;
  old_flag: { active: number; inactive: number };
  new_status: Record<GtgStatus, number>;
  /** Old flag said "Active" but nothing verifies a gateway. */
  false_positives: string[];
  /** Orgs capped under the old flag that the new status no longer caps. */
  cap_lifted_orgs: string[];
}

export function buildBackfillReport(rows: readonly BackfillClientInput[]): BackfillReport {
  const newStatus = {
    verified: 0, verified_no_geo: 0, detected_unverified: 0, partial: 0, legacy: 0,
    broken: 0, not_detected: 0, not_applicable: 0, unknown: 0,
  } as Record<GtgStatus, number>;
  const falsePositives: string[] = [];
  const orgsOldCapped = new Set<string>();
  const orgsStillCapped = new Set<string>();
  let active = 0;
  let inactive = 0;

  for (const r of rows) {
    const status = normaliseGtgStatus(r.gtg_status);
    newStatus[status] += 1;

    if (r.org_has_gtm_connection) {
      active += 1;
      if (!isGtgActive(status)) falsePositives.push(r.client_id);
    } else {
      inactive += 1;
      orgsOldCapped.add(r.organisation_id);
    }
    if (shouldCapScore(status)) orgsStillCapped.add(r.organisation_id);
  }

  return {
    clients: rows.length,
    old_flag: { active, inactive },
    new_status: newStatus,
    false_positives: falsePositives,
    cap_lifted_orgs: [...orgsOldCapped].filter((o) => !orgsStillCapped.has(o)),
  };
}
