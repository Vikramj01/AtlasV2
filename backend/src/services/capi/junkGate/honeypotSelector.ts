/**
 * Honeypot CSS selector validation (GA4 Admin / L11 / Junk Gate PRD §C.5b).
 *
 * The selector is embedded (JSON-encoded) in generated GTM JavaScript, so it is allow-listed here,
 * and the SAME function guards both the config API (reject at save time) and the generator (drop at
 * render time). It lives in its own pure module so the route and the generator share one definition.
 */
export function sanitiseHoneypotSelector(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const v = raw.trim();
  return v.length > 0 && v.length <= 100 && /^[A-Za-z0-9_\-\[\]="'#.: *>]+$/.test(v) ? v : null;
}
