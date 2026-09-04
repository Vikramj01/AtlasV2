/**
 * Layer L10 — Deduplication (2 rules).
 *
 * Every platform's server-side dedup logic (services/capi/dedupStore.ts —
 * the live production Redis-backed store) works by matching the *same*
 * event_id arriving twice: once from a client-side pixel/tag call, once
 * from a server-side (CAPI/sGTM) forward. dedupStore.ts itself needs live
 * provider credentials and a Redis round-trip, so it isn't something a
 * synchronous crawl-time rule can call directly (rules stay pure — see
 * engine.ts's docstrings) — what a single crawl *can* observe is whether
 * the same event_id the client-side dataLayer push carries actually shows
 * up in the other channel(s) that would need to match it for platform-side
 * dedup to work at all. Both rules below check that propagation, not
 * whether dedup itself is currently deduplicating (a production/DB
 * question, not a crawl-time one).
 */
import type { AuditData, ValidationRule, ValidationResult, NetworkRequest } from '@/types/audit';
import { detectPossibleServerSideGtm } from '../../audit/siteSetupDetector';
import { PLATFORM_LABELS, platformTagRequests } from './platformDetection';

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function primaryConversionName(auditData: AuditData): string | undefined {
  return auditData.declared_conversions?.find((c) => c.kind === 'primary')?.name;
}

function primaryConversionEventId(auditData: AuditData): string | undefined {
  const name = primaryConversionName(auditData);
  if (!name) return undefined;
  const event = auditData.dataLayer.find((e) => e.event === name && !!e.event_id);
  return event?.event_id;
}

function requestCarries(request: NetworkRequest, value: string): boolean {
  return request.url.includes(value) || (request.body ?? '').includes(value);
}

// ── L10.1 — event_id consistent from client to server-side delivery ──────────

export const EVENT_ID_CONSISTENT_CLIENT_TO_SERVER: ValidationRule = {
  id: 'L10.1',
  rule_id: 'EVENT_ID_CONSISTENT_CLIENT_TO_SERVER',
  layer: 'deduplication',
  check: 'event_id consistent from client to server-side delivery',
  severity: 'high',
  applies_to: 'all',
  platform_scope: 'n/a',
  detectable_by: 'crawl',
  owner: 'Backend',
  remediation: (result) => {
    const idLine = result.technical_details.evidence.find((e) => e.startsWith('Client event_id:'));
    const id = idLine ? idLine.replace('Client event_id: ', '') : 'the client-side event_id';
    return `Pass ${id} through to the server-side (sGTM/CAPI) delivery call for this same conversion — both sides of a dedup pair need the identical event_id, or the platform can't tell the client and server hits are the same event and counts both.`;
  },

  test(auditData: AuditData): ValidationResult {
    const clientEventId = primaryConversionEventId(auditData);
    if (!clientEventId) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: 'No client-side event_id observed for the primary conversion — see EVENT_ID_PRESENT (L6.7)',
          expected: 'The client-side event_id also appears in the server-side (sGTM/CAPI) delivery channel',
          evidence: ['Rule skipped — nothing to cross-check'],
        },
      };
    }

    const hostname = safeHostname(auditData.website_url);
    const heuristic = detectPossibleServerSideGtm(auditData.networkRequests, hostname);
    if (!heuristic.detected) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: 'No server-side delivery channel detected — see SERVER_CONTAINER_ENDPOINT_CONFIGURED (L1.14)',
          expected: 'The client-side event_id also appears in the server-side (sGTM/CAPI) delivery channel',
          evidence: ['Rule skipped — nothing to cross-check'],
        },
      };
    }

    const matching = auditData.networkRequests.filter(
      (r) => heuristic.candidate_hosts.includes(safeHostname(r.url)) && requestCarries(r, clientEventId),
    );

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: matching.length > 0 ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: matching.length > 0
          ? `event_id "${clientEventId}" observed in ${matching.length} server-side request(s)`
          : `Server-side delivery channel detected, but event_id "${clientEventId}" never appears in its requests`,
        expected: 'The client-side event_id also appears in the server-side (sGTM/CAPI) delivery channel',
        evidence: [`Client event_id: ${clientEventId}`, `Server-side candidate hosts: ${heuristic.candidate_hosts.join(', ')}`],
      },
    };
  },
};

// ── L10.2 — event_id forwarded to declared platform requests ─────────────────
//
// Distinct from L10.1: that rule checks the server-side (sGTM/CAPI)
// channel; this one checks whether the SAME event_id also reaches the
// direct client-side platform request(s) (the browser pixel/tag call
// itself) — both sides of the dedup pair need it, not just one.

export const EVENT_ID_FORWARDED_TO_PLATFORM_REQUESTS: ValidationRule = {
  id: 'L10.2',
  rule_id: 'EVENT_ID_FORWARDED_TO_PLATFORM_REQUESTS',
  layer: 'deduplication',
  check: 'event_id forwarded to declared platform requests',
  severity: 'high',
  applies_to: 'all',
  platform_scope: 'n/a',
  detectable_by: 'crawl',
  owner: 'Backend',
  remediation: (result) => {
    const idLine = result.technical_details.evidence.find((e) => e.startsWith('Platforms checked:'));
    const platforms = idLine ? idLine.replace('Platforms checked: ', '') : 'the declared platform(s)';
    return `Pass the same event_id used elsewhere in this conversion into the direct pixel/tag call for ${platforms} (e.g. fbq's eventID option, or the equivalent parameter for other platforms) — without it, that platform's own client-side hit can't be deduplicated against a server-side delivery of the same event.`;
  },

  test(auditData: AuditData): ValidationResult {
    const clientEventId = primaryConversionEventId(auditData);
    const declared = auditData.declared_platforms ?? [];

    if (!clientEventId) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: 'No client-side event_id observed for the primary conversion — see EVENT_ID_PRESENT (L6.7)',
          expected: 'The client-side event_id is forwarded in at least one declared platform\'s own request',
          evidence: ['Rule skipped — nothing to cross-check'],
        },
      };
    }

    const platformsWithRequests = declared.filter((p) => platformTagRequests(p, auditData).length > 0);
    if (platformsWithRequests.length === 0) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: 'None of the declared platforms have a base tag/pixel request to check — see DECLARED_PLATFORM_HAS_TAG (L0.1)',
          expected: 'The client-side event_id is forwarded in at least one declared platform\'s own request',
          evidence: ['Rule skipped — nothing to cross-check'],
        },
      };
    }

    const carrying = platformsWithRequests.filter((p) =>
      platformTagRequests(p, auditData).some((r) => requestCarries(r, clientEventId)),
    );

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: carrying.length > 0 ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: carrying.length > 0
          ? `event_id "${clientEventId}" forwarded to: ${carrying.map((p) => PLATFORM_LABELS[p]).join(', ')}`
          : `event_id "${clientEventId}" never appears in any declared platform's own request`,
        expected: 'The client-side event_id is forwarded in at least one declared platform\'s own request',
        evidence: [
          `Platforms checked: ${platformsWithRequests.map((p) => PLATFORM_LABELS[p]).join(', ')}`,
          `Carrying the event_id: ${carrying.length > 0 ? carrying.map((p) => PLATFORM_LABELS[p]).join(', ') : 'none'}`,
        ],
      },
    };
  },
};

export const L10_RULES: ValidationRule[] = [
  EVENT_ID_CONSISTENT_CLIENT_TO_SERVER,
  EVENT_ID_FORWARDED_TO_PLATFORM_REQUESTS,
];
