/**
 * Link 3 detection (form carriage) — docs/prd/attribution-chain-check.md §5.2.
 *
 * Pure, synchronous, no I/O — mirrors chainModel.ts's own shape. The one
 * async/browser-dependent part of this link (actually filling the form,
 * clicking submit, and opening an unfiltered network-capture window around
 * that click) lives in journeySimulator.ts, which resolves the raw inputs
 * this module needs and calls detectFormCarriage() synchronously with them,
 * the same "resolve outside, read inside" pattern used throughout this
 * codebase (Key Technical Decision §16).
 *
 * Why this needs its own, unfiltered capture window rather than reusing
 * dataCapture.ts's interceptNetworkRequests: that function's sink is
 * scoped to TRACKED_URL_PATTERNS (ad-platform hosts only — see
 * shouldCaptureUrl there) so every existing Check Register v2 rule can
 * assume "if it's in networkRequests, it's tracking traffic". A lead-gen
 * form's submission target is a CRM/form-vendor endpoint (HubSpot, Marketo,
 * the client's own backend) or the site's own domain — essentially never
 * an ad-platform host — so reusing the tracked-only sink would make Link 3
 * structurally unobservable regardless of the site's real behaviour.
 *
 * Detection is value-matched, never key-matched, against every click-id
 * value this scan actually injected (buildClickIdCandidates) — the same
 * discipline L2's three-tier capture check already established (this
 * codebase's CLAUDE.md, Site Evaluation Coverage & Honesty Phase 3: "matched
 * on the unique synthetic value never the key name"). This also means a
 * hidden field that's present on the form but submitted empty (PRD §5.2's
 * "empty field" case) needs no special-casing at all: an empty value can
 * never contain the injected value, so it fails identically to a field
 * that was never on the form in the first place — which is the correct
 * verdict either way, since both mean the click id didn't survive.
 *
 * Verdict discipline (chainModel.ts's cascade rule depends on this being
 * honest): a form that could never actually be exercised — no lead-gen
 * fields were configured for this scan, the submit control couldn't be
 * reached (e.g. it lives inside a cross-origin iframe our main-frame-only
 * click selector can't reach), or nothing fired afterward at all — is
 * NOT_OBSERVED, never FAIL. Only a genuinely-submitted form whose captured
 * requests carry no trace of the injected value is a real FAIL.
 */

import type { ChainLinkObservation } from './chainModel';

export interface CapturedFormRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface ClickIdCandidate {
  key: string;
  value: string;
}

export interface ClickIdMatch {
  key: string;
  value: string;
  location: 'url' | 'body' | 'header';
  request_url: string;
}

// Click-id-shaped keys only — deliberately excludes the utm_* companions
// makeSyntheticIds() also injects (journeySimulator.ts): a form that
// carries utm_campaign through says nothing about click-id persistence,
// and would produce a false PASS for a site whose UTM params happen to
// round-trip through a query-string-preserving redirect while the actual
// click id is dropped.
export const CLICK_ID_CANDIDATE_KEYS = [
  'gclid', 'fbclid', 'gbraid', 'wbraid', 'ttclid', 'li_fat_id', 'msclkid', 'oppref',
] as const;

/** Builds the candidate list from journeySimulator.ts's makeSyntheticIds() output — anything not present/not a string is silently excluded, never fabricated as an empty-string candidate. */
export function buildClickIdCandidates(injected: Record<string, string | undefined>): ClickIdCandidate[] {
  return CLICK_ID_CANDIDATE_KEYS
    .filter((key): key is typeof CLICK_ID_CANDIDATE_KEYS[number] => typeof injected[key] === 'string' && injected[key]!.length > 0)
    .map((key) => ({ key, value: injected[key] as string }));
}

export function detectFormVendorHost(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

function findMatchInRequest(request: CapturedFormRequest, candidates: ClickIdCandidate[]): ClickIdMatch | null {
  for (const candidate of candidates) {
    if (request.url.includes(candidate.value)) {
      return { key: candidate.key, value: candidate.value, location: 'url', request_url: request.url };
    }
    if (request.body?.includes(candidate.value)) {
      return { key: candidate.key, value: candidate.value, location: 'body', request_url: request.url };
    }
    if (request.headers) {
      for (const headerValue of Object.values(request.headers)) {
        if (headerValue?.includes(candidate.value)) {
          return { key: candidate.key, value: candidate.value, location: 'header', request_url: request.url };
        }
      }
    }
  }
  return null;
}

export interface DetectFormCarriageInput {
  /** True when at least one lead-gen field (test_email/test_phone) was configured for this scan — false means Link 3 was never in scope at all. */
  formInteractionAttempted: boolean;
  /** True when the submit control was actually found and clicked. False covers both "no submit control exists" and "it exists but our main-frame-only selector can't reach it" (e.g. a cross-origin iframe form) — this module deliberately can't and doesn't distinguish those two, since either way the form was never genuinely exercised. */
  submitSucceeded: boolean;
  /** Requests observed during the capture window opened around the submit click — unfiltered by TRACKED_URL_PATTERNS. Includes fetch/XHR-driven SPA submissions exactly like a full navigation, since Playwright's request event fires for both. */
  capturedRequests: CapturedFormRequest[];
  /** Every click-id value this scan actually injected — see buildClickIdCandidates. */
  candidates: ClickIdCandidate[];
}

export function detectFormCarriage(input: DetectFormCarriageInput): ChainLinkObservation {
  if (!input.formInteractionAttempted) {
    return {
      verdict: 'NOT_OBSERVED',
      evidence: 'No lead-gen form fields were configured for this scan (test_email/test_phone not supplied).',
    };
  }

  if (!input.submitSucceeded) {
    return {
      verdict: 'NOT_OBSERVED',
      evidence: 'The form submit control could not be reached — it may live inside a cross-origin iframe, or no submit control was found on the page.',
    };
  }

  if (input.candidates.length === 0) {
    return {
      verdict: 'NOT_OBSERVED',
      evidence: 'No click-id value was injected for this scan, so form carriage could not be tested.',
    };
  }

  if (input.capturedRequests.length === 0) {
    return {
      verdict: 'NOT_OBSERVED',
      evidence: 'The submit control was activated but no network request was observed afterward — the form may not have actually submitted (e.g. blocked by client-side validation).',
    };
  }

  for (const request of input.capturedRequests) {
    const match = findMatchInRequest(request, input.candidates);
    if (match) {
      const vendorHost = detectFormVendorHost(match.request_url);
      return {
        verdict: 'PASS',
        evidence: `The submitted form request to ${vendorHost ?? match.request_url} carried the injected ${match.key} value in its ${match.location}.`,
      };
    }
  }

  const destinationHosts = [...new Set(
    input.capturedRequests.map((r) => detectFormVendorHost(r.url)).filter((h): h is string => !!h),
  )];
  return {
    verdict: 'FAIL',
    evidence: destinationHosts.length > 0
      ? `The form submission fired ${input.capturedRequests.length} request(s) to ${destinationHosts.join(', ')}, but none carried the click id captured at arrival.`
      : `The form submission fired ${input.capturedRequests.length} request(s), but none carried the click id captured at arrival.`,
  };
}
