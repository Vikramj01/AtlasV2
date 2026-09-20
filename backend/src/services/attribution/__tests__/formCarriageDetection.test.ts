import { describe, expect, it } from 'vitest';
import {
  buildClickIdCandidates,
  detectFormCarriage,
  detectFormVendorHost,
  type CapturedFormRequest,
  type ClickIdCandidate,
} from '../formCarriageDetection';

const GCLID_CANDIDATE: ClickIdCandidate = { key: 'gclid', value: 'test_gclid_1700000000000' };

function baseInput(overrides: Partial<Parameters<typeof detectFormCarriage>[0]> = {}) {
  return {
    formInteractionAttempted: true,
    submitSucceeded: true,
    capturedRequests: [] as CapturedFormRequest[],
    candidates: [GCLID_CANDIDATE],
    ...overrides,
  };
}

describe('buildClickIdCandidates', () => {
  it('includes every present click-id-shaped key', () => {
    const injected = {
      gclid: 'test_gclid_1',
      fbclid: 'test_fbclid_1',
      gbraid: 'test_gbraid_1',
      wbraid: 'test_wbraid_1',
      ttclid: 'test_ttclid_1',
      li_fat_id: 'test_lifatid_1',
      msclkid: 'test_msclkid_1',
      oppref: 'test_oppref_1',
    };
    const candidates = buildClickIdCandidates(injected);
    expect(candidates).toHaveLength(8);
    expect(candidates.map((c) => c.key).sort()).toEqual(
      ['fbclid', 'gbraid', 'gclid', 'li_fat_id', 'msclkid', 'oppref', 'ttclid', 'wbraid'].sort(),
    );
  });

  it('excludes utm_* companions even when present alongside click ids', () => {
    const injected = {
      gclid: 'test_gclid_1',
      utm_source: 'atlas_audit',
      utm_campaign: 'atlas_audit_1700000000000',
    };
    const candidates = buildClickIdCandidates(injected);
    expect(candidates).toEqual([{ key: 'gclid', value: 'test_gclid_1' }]);
  });

  it('excludes keys with no value or an empty string', () => {
    const injected = { gclid: 'test_gclid_1', fbclid: undefined, gbraid: '' };
    const candidates = buildClickIdCandidates(injected);
    expect(candidates).toEqual([{ key: 'gclid', value: 'test_gclid_1' }]);
  });

  it('returns an empty array when nothing was injected', () => {
    expect(buildClickIdCandidates({})).toEqual([]);
  });
});

describe('detectFormVendorHost', () => {
  it('strips a leading www.', () => {
    expect(detectFormVendorHost('https://www.hubspot.com/forms/submit')).toBe('hubspot.com');
  });

  it('returns undefined for an unparseable URL', () => {
    expect(detectFormVendorHost('not a url')).toBeUndefined();
  });
});

describe('detectFormCarriage — scope gating (NOT_OBSERVED, never FAIL)', () => {
  it('is NOT_OBSERVED when no lead-gen fields were configured for this scan', () => {
    const result = detectFormCarriage(baseInput({ formInteractionAttempted: false }));
    expect(result.verdict).toBe('NOT_OBSERVED');
    expect(result.evidence).toMatch(/not supplied/);
  });

  it('is NOT_OBSERVED when the submit control could not be reached (cross-origin iframe form)', () => {
    // Simulates a Stripe/Typeform-style embedded form living inside a
    // cross-origin iframe — page.click()'s main-frame-only selector never
    // finds the button, so journeySimulator.ts reports submitSucceeded: false.
    const result = detectFormCarriage(baseInput({ submitSucceeded: false }));
    expect(result.verdict).toBe('NOT_OBSERVED');
    expect(result.evidence).toMatch(/cross-origin iframe/);
  });

  it('is NOT_OBSERVED when no click-id value was injected for this scan', () => {
    const result = detectFormCarriage(baseInput({ candidates: [] }));
    expect(result.verdict).toBe('NOT_OBSERVED');
    expect(result.evidence).toMatch(/No click-id value was injected/);
  });

  it('is NOT_OBSERVED when the submit fired but no network request was ever observed', () => {
    // e.g. client-side required-field validation silently blocked the
    // real submission even though our click() call itself succeeded.
    const result = detectFormCarriage(baseInput({ capturedRequests: [] }));
    expect(result.verdict).toBe('NOT_OBSERVED');
    expect(result.evidence).toMatch(/no network request was observed/);
  });

  it('scope gates are checked in order — a missing submit takes priority over an empty candidate list', () => {
    const result = detectFormCarriage(baseInput({ submitSucceeded: false, candidates: [] }));
    expect(result.evidence).toMatch(/cross-origin iframe/);
  });
});

describe('detectFormCarriage — PASS cases', () => {
  it('matches a value carried in the request URL (classic GET-based form action)', () => {
    const result = detectFormCarriage(baseInput({
      capturedRequests: [{ url: `https://forms.hubspot.com/submit?gclid=${GCLID_CANDIDATE.value}` }],
    }));
    expect(result.verdict).toBe('PASS');
    expect(result.evidence).toMatch(/hubspot\.com/);
    expect(result.evidence).toMatch(/gclid/);
    expect(result.evidence).toMatch(/url/);
  });

  it('matches a value carried in the POST body (standard form submit)', () => {
    const result = detectFormCarriage(baseInput({
      capturedRequests: [{
        url: 'https://www.example.com/api/leads',
        method: 'POST',
        body: `email=test%40example.com&gclid=${GCLID_CANDIDATE.value}`,
      }],
    }));
    expect(result.verdict).toBe('PASS');
    expect(result.evidence).toMatch(/example\.com/);
    expect(result.evidence).toMatch(/body/);
  });

  it('matches a value carried in a request header', () => {
    const result = detectFormCarriage(baseInput({
      capturedRequests: [{
        url: 'https://api.marketo.com/rest/v1/leads',
        headers: { 'X-Atlas-Click-Id': GCLID_CANDIDATE.value },
      }],
    }));
    expect(result.verdict).toBe('PASS');
    expect(result.evidence).toMatch(/header/);
  });

  it('matches an SPA-style fetch/XHR submit with no full-page navigation', () => {
    // The PRD's SPA test scenario: a React/Vue form dispatches fetch()
    // rather than a real form submission — Playwright's request event
    // fires identically for fetch/XHR, so this needs no special handling
    // beyond the unfiltered capture window itself.
    const result = detectFormCarriage(baseInput({
      capturedRequests: [{
        url: 'https://api.example.com/graphql',
        method: 'POST',
        body: JSON.stringify({ operationName: 'SubmitLead', variables: { gclid: GCLID_CANDIDATE.value } }),
      }],
    }));
    expect(result.verdict).toBe('PASS');
  });

  it('matches when the winning request is not the first one captured in the window', () => {
    const result = detectFormCarriage(baseInput({
      capturedRequests: [
        { url: 'https://cdn.example.com/analytics-beacon.gif' },
        { url: 'https://www.example.com/api/leads', body: `gclid=${GCLID_CANDIDATE.value}` },
      ],
    }));
    expect(result.verdict).toBe('PASS');
  });

  it('picks whichever configured candidate actually matches, not just the first in the list', () => {
    const fbclid: ClickIdCandidate = { key: 'fbclid', value: 'test_fbclid_1700000000000' };
    const result = detectFormCarriage(baseInput({
      candidates: [GCLID_CANDIDATE, fbclid],
      capturedRequests: [{ url: `https://forms.example.com/submit?fbclid=${fbclid.value}` }],
    }));
    expect(result.verdict).toBe('PASS');
    expect(result.evidence).toMatch(/fbclid/);
  });
});

describe('detectFormCarriage — FAIL cases', () => {
  it('fails when the form submitted but the captured requests carry no injected value at all', () => {
    const result = detectFormCarriage(baseInput({
      capturedRequests: [{ url: 'https://www.example.com/api/leads', body: 'email=test%40example.com' }],
    }));
    expect(result.verdict).toBe('FAIL');
    expect(result.evidence).toMatch(/example\.com/);
    expect(result.evidence).toMatch(/none carried the click id/);
  });

  it('fails identically whether the hidden click-id field is absent or present-but-empty (PRD §5.2 empty-field case)', () => {
    // Field absent entirely.
    const withoutField = detectFormCarriage(baseInput({
      capturedRequests: [{ url: 'https://www.example.com/api/leads', body: 'email=test%40example.com' }],
    }));
    // Field present in the submitted body but empty — a value-matched
    // check can never distinguish "no field" from "field submitted empty";
    // both correctly mean the click id did not survive to the request.
    const withEmptyField = detectFormCarriage(baseInput({
      capturedRequests: [{ url: 'https://www.example.com/api/leads', body: 'email=test%40example.com&gclid=' }],
    }));
    expect(withoutField.verdict).toBe('FAIL');
    expect(withEmptyField.verdict).toBe('FAIL');
  });

  it('names every distinct destination host when several requests fired but none matched', () => {
    const result = detectFormCarriage(baseInput({
      capturedRequests: [
        { url: 'https://cdn.example.com/beacon.gif' },
        { url: 'https://www.example.com/api/leads', body: 'email=test%40example.com' },
      ],
    }));
    expect(result.verdict).toBe('FAIL');
    expect(result.evidence).toMatch(/cdn\.example\.com/);
    expect(result.evidence).toMatch(/www\.example\.com|example\.com/);
  });

  it('falls back to naming the request count when no destination host could be parsed', () => {
    const result = detectFormCarriage(baseInput({
      capturedRequests: [{ url: 'not a real url', body: 'email=test%40example.com' }],
    }));
    expect(result.verdict).toBe('FAIL');
    expect(result.evidence).toMatch(/1 request/);
  });

  it('a value present as a substring only of an unrelated field never produces a false PASS', () => {
    // The candidate value itself must appear verbatim; a merely-similar
    // value must not accidentally satisfy the match.
    const result = detectFormCarriage(baseInput({
      capturedRequests: [{ url: 'https://www.example.com/api/leads', body: `session_id=unrelated_${GCLID_CANDIDATE.value.slice(0, 5)}xyz` }],
    }));
    expect(result.verdict).toBe('FAIL');
  });
});
