/**
 * Attribution chain model — docs/prd/attribution-chain-check.md §4.
 *
 * Pure, synchronous, no I/O. Every other file in this feature (link 3
 * detection, the register rule, the Campaign Signal Validator lead-gen
 * path) calls into this one to turn raw per-link observations into the
 * single output this PRD sells: one named break, not a score.
 *
 * Two gates (§2.1), never conflated:
 *   - Pre-connection (arrival/persistence/form_carriage) — from a URL-only
 *     scan. This is the diagnostic that is sold against.
 *   - Post-connection (crm_arrival/real_population) — via readinessCheck.ts's
 *     sample-based verdict, already built for CRM Outcome Integration.
 * A pre-connection result never asserts anything about the post-connection
 * links — `scope` records which gate produced this result, and the two
 * post-connection links are always forced to NOT_OBSERVED when
 * scope === 'pre_connection', regardless of what a caller passes in.
 *
 * Cascade rule (§4): once a link FAILs, every link after it in LINK_ORDER
 * resolves to NOT_OBSERVED, never FAIL — you cannot observe whether a CRM
 * property would have been populated by a click ID that never reached the
 * form. Asserting FAIL there would be exactly the absence-as-certainty
 * claim outputLint.ts exists to prevent elsewhere in this codebase. This
 * function enforces the cascade itself rather than trusting callers to get
 * it right, the same "the pure function is the single source of truth for
 * the invariant" shape as the Check Register v2 verdict lattice.
 *
 * not_observed_reason (§6) is a whole-scan concern, not a per-link one — a
 * prospect running no paid campaigns, or a scan that never reached a
 * conversion surface, produces a chain that found nothing everywhere, and
 * that is not a failure. When a caller supplies a reason, it overrides
 * every raw link verdict: the entire result becomes NOT_OBSERVED, with no
 * break and no remedy tier, per acceptance criteria 4 and 5.
 *
 * No score. Nothing in this module can produce a percentage, and that is
 * deliberate — see acceptance criterion 8. Do not "improve" this into one.
 */

export type LinkVerdict = 'PASS' | 'FAIL' | 'NOT_OBSERVED';

export type ChainLink =
  | 'arrival' | 'persistence' | 'form_carriage' | 'crm_arrival' | 'real_population';

export type RemedyTier = 1 | 2 | 3 | 4 | 5;

export type NotObservedReason = 'no_paid_traffic' | 'no_conversion_surface';

export type AttributionChainScope = 'pre_connection' | 'post_connection';

// Fixed evaluation order — also the cascade order. Do not reorder without
// updating both REMEDY_TIER_BY_LINK and REMEDY_TIER_INFO below to match.
export const LINK_ORDER: readonly ChainLink[] = [
  'arrival', 'persistence', 'form_carriage', 'crm_arrival', 'real_population',
];

export const REMEDY_TIER_BY_LINK: Record<ChainLink, RemedyTier> = {
  arrival: 1,
  persistence: 2,
  form_carriage: 3,
  crm_arrival: 4,
  real_population: 5,
};

// §7's break-to-remedy mapping, as pure data — no prose about price (a
// number in an automated PDF will be wrong, per the PRD). Consumed by
// Sprint 4's PDF/result-page rendering, not by this module's own logic.
export interface RemedyTierInfo {
  tier: RemedyTier;
  link: ChainLink;
  label: string;
  typical_cause: string;
  shape_of_work: string;
}

export const REMEDY_TIER_INFO: Record<ChainLink, RemedyTierInfo> = {
  arrival: {
    tier: 1,
    link: 'arrival',
    label: 'Tier 1 — smallest',
    typical_cause: 'Auto-tagging off; a redirect or CDN rule stripping params; consent gate rewriting the URL',
    shape_of_work: 'The best possible first engagement — dramatic effect, minimal effort.',
  },
  persistence: {
    tier: 2,
    link: 'persistence',
    label: 'Tier 2 — small',
    typical_cause: 'No capture tag deployed',
    shape_of_work: 'Atlas already generates the GTM click-ID capture tag and can deploy it as a draft workspace. Mostly an approval conversation.',
  },
  form_carriage: {
    tier: 3,
    link: 'form_carriage',
    label: 'Tier 3 — variable',
    typical_cause: 'Hidden field absent or not populated at submit',
    shape_of_work: 'Effort depends entirely on the form vendor. Scope after identifying the vendor, never quote blind.',
  },
  crm_arrival: {
    tier: 4,
    link: 'crm_arrival',
    label: 'Tier 4 — moderate',
    typical_cause: 'No CRM property exists for the value, or the form tool has no field mapping configured for it',
    shape_of_work: 'Predictable. Post-connection finding only.',
  },
  real_population: {
    tier: 5,
    link: 'real_population',
    label: 'Tier 5 — diagnostic',
    typical_cause: 'Fix applied but never deployed, or applied to one form of several',
    shape_of_work: 'Cheap to find, worth catching — looks like success from both ends.',
  },
};

export interface AttributionChainResult {
  links: Record<ChainLink, LinkVerdict>;
  /** First failing link, or null if nothing failed. The headline. */
  break_at: ChainLink | null;
  /** Why the break was called, in evidence terms. Empty when break_at is null. */
  break_evidence: string;
  /** Which remedy tier the break maps to (§7). Null when break_at is null. */
  remedy_tier: RemedyTier | null;
  /** True when no click ID could be observed at all — see §6. */
  not_observed_reason: NotObservedReason | null;
  /** Explicit: a clean pre-connection result does not prove the chain works. */
  scope: AttributionChainScope;
}

export interface ChainLinkObservation {
  verdict: LinkVerdict;
  /** Evidence text, surfaced in break_evidence only if this link is the break. */
  evidence?: string;
}

export interface ComputeAttributionChainInput {
  scope: AttributionChainScope;
  /**
   * Set when the whole chain could not be exercised at all (§6) — e.g. no
   * paid-platform click ID was ever injected because none is declared, or
   * no conversion surface was reached. Overrides every link's raw verdict:
   * the whole result becomes NOT_OBSERVED, with no break and no remedy.
   */
  not_observed_reason?: NotObservedReason | null;
  arrival: ChainLinkObservation;
  persistence: ChainLinkObservation;
  form_carriage: ChainLinkObservation;
  /** Post-connection only (readinessCheck.ts's verdict) — ignored otherwise. */
  crm_arrival?: ChainLinkObservation;
  /** Post-connection only (readinessCheck.ts's verdict) — ignored otherwise. */
  real_population?: ChainLinkObservation;
}

const ALL_NOT_OBSERVED: Record<ChainLink, LinkVerdict> = {
  arrival: 'NOT_OBSERVED',
  persistence: 'NOT_OBSERVED',
  form_carriage: 'NOT_OBSERVED',
  crm_arrival: 'NOT_OBSERVED',
  real_population: 'NOT_OBSERVED',
};

export function computeAttributionChain(input: ComputeAttributionChainInput): AttributionChainResult {
  if (input.not_observed_reason) {
    return {
      links: { ...ALL_NOT_OBSERVED },
      break_at: null,
      break_evidence: '',
      remedy_tier: null,
      not_observed_reason: input.not_observed_reason,
      scope: input.scope,
    };
  }

  const isPostConnection = input.scope === 'post_connection';
  const rawByLink: Record<ChainLink, ChainLinkObservation> = {
    arrival: input.arrival,
    persistence: input.persistence,
    form_carriage: input.form_carriage,
    crm_arrival: (isPostConnection && input.crm_arrival) || { verdict: 'NOT_OBSERVED' },
    real_population: (isPostConnection && input.real_population) || { verdict: 'NOT_OBSERVED' },
  };

  const links = {} as Record<ChainLink, LinkVerdict>;
  let breakAt: ChainLink | null = null;
  let breakEvidence = '';

  for (const link of LINK_ORDER) {
    if (breakAt) {
      // Cascade rule — never FAIL, never a re-derived PASS, once broken.
      links[link] = 'NOT_OBSERVED';
      continue;
    }

    const observation = rawByLink[link];
    links[link] = observation.verdict;

    if (observation.verdict === 'FAIL') {
      breakAt = link;
      breakEvidence = observation.evidence ?? `The chain broke at ${link}.`;
    }
  }

  return {
    links,
    break_at: breakAt,
    break_evidence: breakEvidence,
    remedy_tier: breakAt ? REMEDY_TIER_BY_LINK[breakAt] : null,
    not_observed_reason: null,
    scope: input.scope,
  };
}
