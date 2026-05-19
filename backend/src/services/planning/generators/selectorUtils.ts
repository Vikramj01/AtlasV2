/**
 * CSS selector sanitization for GTM trigger generation.
 *
 * GTM trigger filters only accept valid CSS selectors. Playwright-style
 * pseudo-selectors like :has-text(), :contains(), and :text() are invalid
 * and cause the GenerationValidator's SELECTOR_VALIDITY rule to block output.
 *
 * sanitizeSelector() strips invalid parts from a comma-separated selector
 * list and returns either a clean CSS selector or a text fallback for use
 * with a click_text trigger.
 */

const INVALID_FRAGMENTS = [':contains(', ':has-text(', ':text('];

function isInvalidPart(part: string): boolean {
  return INVALID_FRAGMENTS.some(f => part.includes(f));
}

/** Extract the text value from the first :has-text() or :contains() call. */
function extractText(selector: string): string | undefined {
  const m = selector.match(/(?::has-text|:contains)\(['"]([^'"]+)['"]\)/);
  return m?.[1];
}

export interface SanitizedSelector {
  /** Clean CSS selector — use for click_css / form_submit triggers. */
  selector: string;
  textFallback?: never;
}

export interface TextFallback {
  selector?: never;
  /** Visible text extracted from the original pseudo-selector — use for click_text triggers. */
  textFallback: string;
}

export type SanitizeResult = SanitizedSelector | TextFallback;

/**
 * Sanitize a raw element_selector coming from an AI recommendation.
 *
 * Returns `{ selector }` when at least one valid CSS part survives,
 * or `{ textFallback }` when only invalid pseudo-selectors were present
 * so the caller can fall back to a click_text trigger.
 *
 * Returns `null` when the input is empty/falsy.
 */
export function sanitizeSelector(raw: string | undefined | null): SanitizeResult | null {
  if (!raw) return null;

  const parts = raw.split(',').map(p => p.trim()).filter(Boolean);
  const valid = parts.filter(p => !isInvalidPart(p));

  if (valid.length > 0) {
    return { selector: valid.join(', ') };
  }

  // All parts were invalid — try to recover a text value
  const text = extractText(raw);
  if (text) {
    return { textFallback: text };
  }

  return null;
}
