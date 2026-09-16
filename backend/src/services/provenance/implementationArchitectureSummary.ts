/**
 * Implementation Architecture report section (Signal vs Implementation PRD
 * P1-05) — the presentation layer over P1-01/P1-02/P1-04's request-
 * provenance classification (implementationPathClassifier.ts), P1-03's
 * commerce-platform detection, and P1-06's duplicate-implementation
 * detection (duplicateImplementationDetector.ts). No new detection logic
 * lives here — this module only assembles already-classified data into the
 * shape the report renders.
 *
 * Returns undefined (not an empty-array shell) when the scan captured no
 * request_provenance at all — e.g. a pre-P1-01 audit, or a run with no CDP
 * session access (interceptRequestInitiators fails open) — so the report
 * section is omitted entirely rather than rendering a false "no
 * implementation paths found" state, per CLAUDE.md rule 12.
 */
import type {
  AuditData,
  ImplementationPath,
  ImplementationArchitectureSummary,
  ImplementationPathRow,
  UnattributedImplementationRow,
} from '@/types/audit';
import { classifyImplementationPaths } from './implementationPathClassifier';
import { detectDuplicateImplementations } from './duplicateImplementationDetector';

/**
 * `'high'` for a path derived from a directly-matched loader/pixel script
 * URL in the initiator chain (GTM, DIRECT_SCRIPT); `'medium'` for a path
 * derived from corroborating-but-indirect evidence (SHOPIFY_WEB_PIXEL — a
 * sandboxed frame plus independent commerce-platform detection, per the
 * Sprint 10 spike — and the reserved HYBRID/SERVER_SIDE/Shopify sub-types,
 * if ever activated). Exhaustive over every non-UNKNOWN ImplementationPath
 * value so a newly-activated path can't silently ship without a considered
 * confidence tier.
 */
export function confidenceForPath(path: Exclude<ImplementationPath, 'UNKNOWN'>): 'high' | 'medium' {
  switch (path) {
    case 'GTM':
    case 'DIRECT_SCRIPT':
      return 'high';
    case 'SHOPIFY_WEB_PIXEL':
    case 'SHOPIFY_APP_PIXEL':
    case 'SHOPIFY_CUSTOM_PIXEL':
    case 'SHOPIFY_THEME':
    case 'SERVER_SIDE':
    case 'HYBRID':
      return 'medium';
  }
}

export function buildImplementationArchitectureSummary(
  auditData: Pick<AuditData, 'request_provenance' | 'commerce_platform'>,
): ImplementationArchitectureSummary | undefined {
  const { request_provenance, commerce_platform } = auditData;
  if (!request_provenance || request_provenance.length === 0) return undefined;

  const classifications = classifyImplementationPaths(request_provenance, commerce_platform);

  const paths: ImplementationPathRow[] = [];
  const unattributed: UnattributedImplementationRow[] = [];
  for (const c of classifications) {
    if (c.path === 'UNKNOWN') {
      unattributed.push({ platform: c.platform, page: c.page, request_urls: c.request_urls, evidence: c.evidence });
    } else {
      paths.push({ platform: c.platform, page: c.page, path: c.path, confidence: confidenceForPath(c.path), request_urls: c.request_urls, evidence: c.evidence });
    }
  }

  return {
    generated_at: new Date().toISOString(),
    commerce_platform,
    paths,
    unattributed,
    duplicates: detectDuplicateImplementations(classifications),
  };
}
