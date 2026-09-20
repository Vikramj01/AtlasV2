/**
 * Attribution Chain Check PRD §7/§8 — builds the human-readable copy for an
 * AttributionChainResult, shared by the PDF (pdfGenerator.ts) and, in spirit,
 * the public result page's equivalent React rendering. Pure, no I/O.
 *
 * Three distinct visual registers (PRD §6, acceptance criterion 4) — never
 * conflate them:
 *   - not_observed_reason set: neutral, not an alarm — "could not be
 *     exercised", never "broken".
 *   - break_at null: a genuine pass for Links 1-3, but the copy must state
 *     explicitly that Links 4-5 remain unverified pre-connection (PRD §2.1,
 *     acceptance criterion 3) — a clean result here is necessary, not
 *     sufficient.
 *   - break_at set: the named break, its evidence, and the remedy tier's
 *     *shape* of work — never a price (PRD §7).
 *
 * No percentage anywhere in this module's output (acceptance criterion 8).
 */
import type { AttributionChainResult, ChainLink } from './chainModel';
import { REMEDY_TIER_INFO } from './chainModel';

export const CHAIN_LINK_LABELS: Record<ChainLink, string> = {
  arrival: 'Arrival',
  persistence: 'Persistence',
  form_carriage: 'Form carriage',
  crm_arrival: 'CRM arrival',
  real_population: 'Real population',
};

export interface ChainCopy {
  /** Short, one-line label for the top of the section — the headline this PRD sells (§1.1). */
  headline: string;
  /** Longer explanatory body — one or two sentences. */
  body: string;
  /** Present only when break_at is set — the remedy tier's shape of work, never a price. */
  remedy?: { label: string; typical_cause: string; shape_of_work: string };
  /** Always present when break_at is null and not_observed_reason is null — the "necessary, not sufficient" note. */
  unverified_note?: string;
}

const NOT_OBSERVED_COPY: Record<NonNullable<AttributionChainResult['not_observed_reason']>, ChainCopy> = {
  no_paid_traffic: {
    headline: 'Attribution chain: not yet exercised',
    body: 'No paid click parameters were found in this scan’s observed traffic, so the attribution chain could not be exercised. Re-run this check once paid campaigns are live to see a real result.',
  },
  no_conversion_surface: {
    headline: 'Attribution chain: no lead-gen form reached',
    body: 'This scan found real ad-platform activity but could not reach or submit a lead-gen form on the page, so Links 1 through 3 could not be tested. Confirm a form exists and is reachable, then re-run this check.',
  },
};

export function buildChainCopy(chain: AttributionChainResult): ChainCopy {
  if (chain.not_observed_reason) {
    return NOT_OBSERVED_COPY[chain.not_observed_reason];
  }

  if (!chain.break_at) {
    return {
      headline: 'Attribution chain: no break found in Links 1-3',
      body: 'The click id captured at arrival survived through to the form submission on this scan. This confirms the site-side half of the chain — it does not confirm that the CRM property exists or that live records actually carry the value.',
      unverified_note: 'CRM arrival and real population (Links 4 and 5) require a connected source and remain unverified from this scan alone.',
    };
  }

  const tier = REMEDY_TIER_INFO[chain.break_at];
  return {
    headline: `Attribution chain breaks at: ${CHAIN_LINK_LABELS[chain.break_at]}`,
    body: chain.break_evidence,
    remedy: { label: tier.label, typical_cause: tier.typical_cause, shape_of_work: tier.shape_of_work },
  };
}

/** Every plain-text string this module can produce, across every branch — used by tests to run the shared banned-token lint over all of it at once. */
export function allChainCopyVariants(): string[] {
  const variants: ChainCopy[] = [
    NOT_OBSERVED_COPY.no_paid_traffic,
    NOT_OBSERVED_COPY.no_conversion_surface,
    buildChainCopy({ links: { arrival: 'PASS', persistence: 'PASS', form_carriage: 'PASS', crm_arrival: 'NOT_OBSERVED', real_population: 'NOT_OBSERVED' }, break_at: null, break_evidence: '', remedy_tier: null, not_observed_reason: null, scope: 'pre_connection' }),
    ...(['arrival', 'persistence', 'form_carriage', 'crm_arrival', 'real_population'] as ChainLink[]).map((link) =>
      buildChainCopy({
        links: { arrival: 'PASS', persistence: 'PASS', form_carriage: 'PASS', crm_arrival: 'PASS', real_population: 'PASS', [link]: 'FAIL' },
        break_at: link,
        break_evidence: `Evidence naming the break at ${link}.`,
        remedy_tier: REMEDY_TIER_INFO[link].tier,
        not_observed_reason: null,
        scope: 'pre_connection',
      }),
    ),
  ];
  return variants.flatMap((c) => [c.headline, c.body, c.remedy?.typical_cause, c.remedy?.shape_of_work, c.unverified_note].filter((s): s is string => !!s));
}
