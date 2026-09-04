/**
 * Layer L9 — Server-Side Delivery (2 rules).
 *
 * L1.14/L1.15 (foundation_tags) already promoted siteSetupDetector.ts's
 * detectPossibleServerSideGtm() request-shape heuristic to a scored "is
 * there any sGTM-shaped traffic at all" check — this layer is deliberately
 * scoped to what those two don't cover: the client's actual, DB-verified
 * sGTM connection (AuditData.sgtmVerified, resolved by the orchestrator
 * from client_platforms.is_verified before rules run — same "resolve
 * outside, read inside" pattern as connected_gtm_container_id), and
 * whether that verified connection is actually reflected in what this
 * specific crawl observed. Reuses both existing signals rather than
 * re-deriving either (Site Evaluation Coverage & Honesty PRD §11).
 */
import type { AuditData, ValidationRule, ValidationResult } from '@/types/audit';
import { detectPossibleServerSideGtm } from '../../audit/siteSetupDetector';

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

// ── L9.1 — Server-side GTM connection verified ────────────────────────────────

export const SERVER_SIDE_GTM_CONNECTION_VERIFIED: ValidationRule = {
  id: 'L9.1',
  rule_id: 'SERVER_SIDE_GTM_CONNECTION_VERIFIED',
  layer: 'server_side_delivery',
  check: 'Server-side GTM connection verified',
  severity: 'high',
  applies_to: 'all',
  platform_scope: 'n/a',
  detectable_by: 'crawl',
  owner: 'Backend',

  test(auditData: AuditData): ValidationResult {
    const verified = auditData.sgtmVerified;

    if (verified === undefined) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: 'No server-side GTM endpoint is connected for this client',
          expected: 'A connected sGTM endpoint (client_platforms) is verified reachable',
          evidence: ['Rule skipped — nothing to verify'],
        },
      };
    }

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: verified ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: verified
          ? 'The connected server-side GTM endpoint is verified reachable'
          : 'A server-side GTM endpoint is connected but failed verification',
        expected: 'A connected sGTM endpoint (client_platforms) is verified reachable',
        evidence: [`sGTM connection verified: ${verified}`],
      },
    };
  },
};

// ── L9.2 — Verified connection's traffic actually observed this crawl ────────
//
// Cross-checks sgtmVerified (a point-in-time DB verification, potentially
// stale) against what THIS crawl actually saw in network traffic. A
// verified connection with no matching traffic during a real crawl is a
// meaningful signal — the endpoint might have gone down, or triggers might
// not be configured for this site_type/funnel — even though L9.1 alone
// would still report "verified" from the stale DB record.

export const VERIFIED_SGTM_TRAFFIC_OBSERVED: ValidationRule = {
  id: 'L9.2',
  rule_id: 'VERIFIED_SGTM_TRAFFIC_OBSERVED',
  layer: 'server_side_delivery',
  check: 'Verified sGTM connection\'s traffic observed this crawl',
  severity: 'medium',
  applies_to: 'all',
  platform_scope: 'n/a',
  detectable_by: 'crawl',
  owner: 'Backend',

  test(auditData: AuditData): ValidationResult {
    if (auditData.sgtmVerified !== true) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: 'No verified server-side GTM connection to cross-check — see SERVER_SIDE_GTM_CONNECTION_VERIFIED (L9.1)',
          expected: 'sGTM-shaped traffic is observed during a crawl of a verified connection',
          evidence: ['Rule skipped — nothing to cross-check'],
        },
      };
    }

    const hostname = safeHostname(auditData.website_url);
    const heuristic = detectPossibleServerSideGtm(auditData.networkRequests, hostname);

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: heuristic.detected ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: heuristic.detected
          ? `sGTM-shaped traffic observed this crawl (${heuristic.confidence} confidence): ${heuristic.candidate_hosts.join(', ')}`
          : 'The connection is verified in Atlas, but no sGTM-shaped traffic was observed during this crawl',
        expected: 'sGTM-shaped traffic is observed during a crawl of a verified connection',
        evidence: heuristic.detected
          ? [heuristic.caveat, ...heuristic.evidence_urls]
          : ['No sGTM-shaped request detected this crawl — the endpoint may be down, or triggers may not be configured for this page/funnel'],
      },
    };
  },
};

export const L9_RULES: ValidationRule[] = [
  SERVER_SIDE_GTM_CONNECTION_VERIFIED,
  VERIFIED_SGTM_TRAFFIC_OBSERVED,
];
