/**
 * Shared consent-banner (CMP) detection/dismissal.
 *
 * Extracted from publicAuditRunner.ts's acceptCookieConsent() (Site
 * Evaluation Coverage & Honesty PRD §6.5) so the crawl-based Audit Engine
 * (journeySimulator.ts) and the public no-login instant-audit path share
 * one implementation instead of maintaining two copies that drift apart.
 * publicAuditRunner.ts is refactored to import from here.
 *
 * Selector list + text-match fallback are unchanged from the original —
 * moved verbatim, not rewritten.
 */
import type { CMP } from '@/types/audit';

export interface CmpSelector {
  selector: string;
  vendor: CMP;
}

/** Known "accept all" button selectors per CMP vendor. Order matters: first match wins. */
export const CMP_SELECTORS: CmpSelector[] = [
  { selector: '#onetrust-accept-btn-handler', vendor: 'onetrust' },
  { selector: '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll', vendor: 'cookiebot' },
  { selector: '#CybotCookiebotDialogBodyButtonAccept', vendor: 'cookiebot' },
  { selector: '.CybotCookiebotDialogBodyButton', vendor: 'cookiebot' },
  { selector: '#accept-cookie-consent', vendor: 'custom' },
  { selector: '#cookie-consent-accept', vendor: 'custom' },
  { selector: '#coiConsentBtn', vendor: 'custom' },
  { selector: '[data-testid="uc-accept-all-button"]', vendor: 'usercentrics' },
  { selector: '.uc-btn-accept-banner', vendor: 'usercentrics' },
  { selector: '#didomi-notice-agree-button', vendor: 'custom' },
  { selector: '.cm-btn-accept', vendor: 'custom' },
  { selector: '.cc-btn.cc-allow', vendor: 'custom' },
  { selector: '#cookie-law-info-bar .cli_action_button', vendor: 'custom' },
  { selector: 'button[data-cky-tag="accept-button"]', vendor: 'custom' },
];

/** Text-match fallback when no known selector matches, including common EU-language phrasing. */
export const CMP_TEXT_MATCHERS: string[] = [
  'accept all', 'accept all cookies', 'allow all', 'allow all cookies', 'i accept',
  'godkänn alla', 'acceptera alla', // Swedish
  'alle akzeptieren', // German
  'tout accepter', // French
  'accepteren alle', 'alles accepteren', // Dutch
  'accetta tutti', // Italian
  'aceptar todo', // Spanish
];

/**
 * A page whose evaluate() can take a serializable argument — needed here
 * (unlike every other page.evaluate() call in this codebase) because the
 * selector/text-matcher lists must cross the CDP boundary as data rather
 * than being duplicated as literals inside two separate browser-side
 * closures. Real Playwright pages support this natively; call sites cast
 * their narrower page type the same way they already do for every other
 * dataCapture.ts helper (e.g. `page as Parameters<typeof flushDataLayer>[0]`).
 */
export interface EvaluatePage {
  evaluate<T, Arg>(fn: (arg: Arg) => T, arg: Arg): Promise<T>;
}

export interface ConsentBannerDetection {
  present: boolean;
  vendor?: CMP;
  selector?: string;
}

/** Declared-vendor-first ordering, shared by detect and dismiss so they always agree on which element they mean. */
function orderByDeclaredVendor(declaredVendor?: CMP): CmpSelector[] {
  if (!declaredVendor || declaredVendor === 'custom' || declaredVendor === 'none') return CMP_SELECTORS;
  const matching = CMP_SELECTORS.filter((s) => s.vendor === declaredVendor);
  const rest = CMP_SELECTORS.filter((s) => s.vendor !== declaredVendor);
  return [...matching, ...rest]; // declared vendor's own selectors tried first, then every other known selector
}

/**
 * Reports whether a consent banner is currently present — without clicking
 * anything — so the caller can snapshot pre-consent state before calling
 * dismissConsentBanner. Tries the declared vendor's own selectors first
 * when declaredVendor is given, then every other known selector, then a
 * text match against any clickable element.
 */
export async function detectConsentBanner(
  page: EvaluatePage,
  declaredVendor?: CMP,
): Promise<ConsentBannerDetection> {
  const selectors = orderByDeclaredVendor(declaredVendor);

  return page.evaluate(
    ({ selectors, textMatchers }) => {
      for (const { selector, vendor } of selectors) {
        if (document.querySelector(selector)) return { present: true, vendor, selector };
      }

      const candidates = Array.from(
        document.querySelectorAll('button, a[role="button"], [role="button"], input[type="button"]'),
      );
      for (const el of candidates) {
        const text = ((el as HTMLElement).textContent || (el as HTMLInputElement).value || '').trim().toLowerCase();
        if (textMatchers.some((t) => text === t || text.includes(t))) {
          return { present: true, vendor: 'custom' as const };
        }
      }

      return { present: false };
    },
    { selectors, textMatchers: CMP_TEXT_MATCHERS },
  );
}

/**
 * Clicks through a detected consent banner — same selector/text-match
 * strategy and priority order as detectConsentBanner, but performs the
 * click. Returns whether anything was actually clicked.
 */
export async function dismissConsentBanner(page: EvaluatePage, declaredVendor?: CMP): Promise<boolean> {
  const selectors = orderByDeclaredVendor(declaredVendor);

  return page.evaluate(
    ({ selectors, textMatchers }) => {
      for (const { selector } of selectors) {
        const el = document.querySelector(selector) as HTMLElement | null;
        if (el) {
          el.click();
          return true;
        }
      }

      const candidates = Array.from(
        document.querySelectorAll('button, a[role="button"], [role="button"], input[type="button"]'),
      );
      for (const el of candidates) {
        const text = ((el as HTMLElement).textContent || (el as HTMLInputElement).value || '').trim().toLowerCase();
        if (textMatchers.some((t) => text === t || text.includes(t))) {
          (el as HTMLElement).click();
          return true;
        }
      }

      return false;
    },
    { selectors, textMatchers: CMP_TEXT_MATCHERS },
  );
}
