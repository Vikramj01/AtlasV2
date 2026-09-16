/**
 * Duplicate implementation detection (Signal vs Implementation PRD P1-06).
 *
 * The highest-commercial-value P1 output per the PRD: a theme pixel plus
 * an app pixel plus a GTM tag all firing the same platform's signal on one
 * page is one of the most common and most expensive faults on Shopify, and
 * unlike most findings in this register, a client can verify it against
 * their own platform numbers immediately — no ad-account access needed.
 *
 * A pure function over classifyImplementationPaths()'s own output
 * (implementationPathClassifier.ts), which already produces one row per
 * distinct (platform, page, path) rather than collapsing a platform's
 * multiple simultaneous paths into a single verdict — Sprint 8 (this file)
 * is exactly the "close to free" consumer of that multiplicity the sprint
 * plan predicted.
 *
 * `UNKNOWN` paths never count toward a duplicate — two `UNKNOWN` rows for
 * the same (platform, page) mean "we don't know how this fired, twice,"
 * not "two confirmed different mechanisms." Only genuinely distinct known
 * paths count: GTM, DIRECT_SCRIPT, and (since Sprint 11/P1-04, path-only)
 * SHOPIFY_WEB_PIXEL — a GTM tag plus a genuine Shopify Web Pixels Manager
 * sandbox both firing the same platform's signal on one page is exactly
 * the class of finding this detector exists for. The three more specific
 * Shopify sub-types (SHOPIFY_APP_PIXEL/SHOPIFY_CUSTOM_PIXEL/SHOPIFY_THEME)
 * stay unactivated — Shopify's sandbox isolation means they can't be told
 * apart from outside it (see implementationPathClassifier.ts).
 */
import type { ImplementationPathClassification, DuplicateImplementationFinding } from '@/types/audit';

/**
 * Flags every (platform, page) pair where classifyImplementationPaths()
 * produced two or more distinct, known (non-UNKNOWN) paths. Deliberately
 * flags "more than one delivery mechanism reaches this page" — real,
 * directly observed evidence — not "the identical event fires twice,"
 * which would need per-request event-identity parsing this detector
 * doesn't do (see DuplicateImplementationFinding's own docstring).
 */
export function detectDuplicateImplementations(
  classifications: ImplementationPathClassification[],
): DuplicateImplementationFinding[] {
  const byPlatformPage = new Map<string, ImplementationPathClassification[]>();
  for (const c of classifications) {
    if (c.path === 'UNKNOWN') continue;
    const key = `${c.platform}|${c.page}`;
    const bucket = byPlatformPage.get(key) ?? [];
    bucket.push(c);
    byPlatformPage.set(key, bucket);
  }

  const findings: DuplicateImplementationFinding[] = [];
  for (const rows of byPlatformPage.values()) {
    const distinctPaths = [...new Set(rows.map((r) => r.path))];
    if (distinctPaths.length < 2) continue;

    findings.push({
      platform: rows[0].platform,
      page: rows[0].page,
      paths: distinctPaths,
      request_urls: [...new Set(rows.flatMap((r) => r.request_urls))],
      evidence: [...new Set(rows.flatMap((r) => r.evidence))],
    });
  }

  return findings;
}
