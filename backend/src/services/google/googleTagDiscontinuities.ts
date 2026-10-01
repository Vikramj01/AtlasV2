/**
 * Google Tag Topology PRD §7.4 / §8.1 (Sprint 5) — a verified split changes how
 * data is collected for a client mid-stream. It is recorded as a CLIENT-scoped
 * discontinuity (`platform_discontinuities.kind = 'client_tracking_change'`) so
 * reconciliation reads the step change as annotated context and AIR correlates
 * it, rather than either reporting an unexplained anomaly the week a client
 * does the right thing.
 *
 * Pure: builds the rows and validates the date; the writer lives in
 * database/discontinuityQueries.ts.
 */
export const SPLIT_DISCONTINUITY_TITLE = 'Google tag split';
export const SPLIT_DISCONTINUITY_DESCRIPTION =
  'Google tag split: destinations separated, data collected per destination from this date';

/** The two platforms a Google tag split changes. Matches platform_connections.platform / AIR sources. */
export const SPLIT_AFFECTED_PLATFORMS = ['ga4', 'google_ads'] as const;

export interface ClientDiscontinuityRow {
  platform: string;
  title: string;
  effective_date: string;
  description: string;
  kind: 'client_tracking_change';
  client_id: string;
  organization_id: string;
}

export function buildSplitDiscontinuityRows(args: {
  organizationId: string;
  clientId: string;
  effectiveDate: string;
}): ClientDiscontinuityRow[] {
  return SPLIT_AFFECTED_PLATFORMS.map((platform) => ({
    platform,
    title: SPLIT_DISCONTINUITY_TITLE,
    effective_date: args.effectiveDate,
    description: SPLIT_DISCONTINUITY_DESCRIPTION,
    kind: 'client_tracking_change' as const,
    client_id: args.clientId,
    organization_id: args.organizationId,
  }));
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The effective date is the verification date, or an operator-supplied split
 * date when it is EARLIER and plausible: a real calendar date, not in the
 * future, and not before the plan existed (the split follows the plan).
 * Returns the date to use, or an error naming why a supplied date was refused.
 */
export function resolveSplitEffectiveDate(args: {
  splitDate?: string;
  planCreatedAt: Date;
  now: Date;
}): { date: string } | { error: string } {
  const today = args.now.toISOString().slice(0, 10);
  if (args.splitDate === undefined) return { date: today };

  if (!ISO_DATE.test(args.splitDate) || Number.isNaN(new Date(`${args.splitDate}T00:00:00Z`).getTime())) {
    return { error: 'split_date must be a valid YYYY-MM-DD date' };
  }
  if (args.splitDate > today) return { error: 'split_date cannot be in the future' };
  if (args.splitDate < args.planCreatedAt.toISOString().slice(0, 10)) {
    return { error: 'split_date cannot be before the split plan was created' };
  }
  return { date: args.splitDate };
}
