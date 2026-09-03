/**
 * Unit tests for consentBanner.ts's public contract and declared-vendor
 * ordering. The actual selector-matching/click logic runs inside
 * page.evaluate() — real DOM code with no equivalent in this Node-only test
 * environment (same constraint every other page.evaluate()-based helper in
 * this codebase works under — see dataCapture.test.ts) — so evaluate() is
 * mocked to return canned results, same pattern as dataCapture.test.ts.
 * What's actually under test here: which selector list gets sent across
 * the CDP boundary in which order, and that detect/dismiss correctly pass
 * through whatever the browser side reports.
 */
import { describe, it, expect, vi } from 'vitest';
import { detectConsentBanner, dismissConsentBanner, CMP_SELECTORS, CMP_TEXT_MATCHERS } from '../consentBanner';

function makePage(resolvedValue: unknown) {
  return { evaluate: vi.fn().mockResolvedValue(resolvedValue) };
}

describe('detectConsentBanner', () => {
  it('passes every known selector and the text matchers across to evaluate()', async () => {
    const page = makePage({ present: false });
    await detectConsentBanner(page);

    const [fn, arg] = page.evaluate.mock.calls[0];
    expect(typeof fn).toBe('function');
    expect(arg.selectors).toHaveLength(CMP_SELECTORS.length);
    expect(arg.textMatchers).toEqual(CMP_TEXT_MATCHERS);
  });

  it('orders the declared vendor\'s own selectors first when a declaredVendor is given', async () => {
    const page = makePage({ present: false });
    await detectConsentBanner(page, 'cookiebot');

    const [, arg] = page.evaluate.mock.calls[0];
    const cookiebotCount = CMP_SELECTORS.filter((s) => s.vendor === 'cookiebot').length;
    expect(arg.selectors.slice(0, cookiebotCount).every((s: { vendor: string }) => s.vendor === 'cookiebot')).toBe(true);
    // Every selector is still present — declaring a vendor reorders, never filters.
    expect(arg.selectors).toHaveLength(CMP_SELECTORS.length);
  });

  it("does not reorder for 'custom' or 'none' — there's no vendor-specific selector subset to prioritise", async () => {
    const page = makePage({ present: false });
    await detectConsentBanner(page, 'custom');
    const [, argCustom] = page.evaluate.mock.calls[0];
    expect(argCustom.selectors).toEqual(CMP_SELECTORS);

    const page2 = makePage({ present: false });
    await detectConsentBanner(page2, 'none');
    const [, argNone] = page2.evaluate.mock.calls[0];
    expect(argNone.selectors).toEqual(CMP_SELECTORS);
  });

  it('passes through whatever the browser side reports', async () => {
    const page = makePage({ present: true, vendor: 'onetrust', selector: '#onetrust-accept-btn-handler' });
    const result = await detectConsentBanner(page);
    expect(result).toEqual({ present: true, vendor: 'onetrust', selector: '#onetrust-accept-btn-handler' });
  });

  it('reports absence when nothing matched', async () => {
    const page = makePage({ present: false });
    const result = await detectConsentBanner(page);
    expect(result.present).toBe(false);
  });
});

describe('dismissConsentBanner', () => {
  it('orders the declared vendor first, same as detectConsentBanner', async () => {
    const page = makePage(true);
    await dismissConsentBanner(page, 'onetrust');

    const [, arg] = page.evaluate.mock.calls[0];
    expect(arg.selectors[0].vendor).toBe('onetrust');
  });

  it('returns whatever the browser side reports was clicked', async () => {
    const page = makePage(true);
    await expect(dismissConsentBanner(page)).resolves.toBe(true);

    const page2 = makePage(false);
    await expect(dismissConsentBanner(page2)).resolves.toBe(false);
  });
});

describe('CMP_SELECTORS / CMP_TEXT_MATCHERS', () => {
  it('every declared CMP vendor except none/custom has at least one selector', () => {
    const vendorsWithSelectors = new Set(CMP_SELECTORS.map((s) => s.vendor));
    expect(vendorsWithSelectors.has('onetrust')).toBe(true);
    expect(vendorsWithSelectors.has('cookiebot')).toBe(true);
    expect(vendorsWithSelectors.has('usercentrics')).toBe(true);
  });

  it('text matchers are all lowercase (matching logic lowercases the observed text before comparing)', () => {
    expect(CMP_TEXT_MATCHERS.every((t) => t === t.toLowerCase())).toBe(true);
  });
});
