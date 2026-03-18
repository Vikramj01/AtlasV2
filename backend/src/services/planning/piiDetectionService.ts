/**
 * PII Detection Service
 *
 * Scans the generated dataLayer spec for fields that may contain
 * personally identifiable information (PII) and returns structured warnings.
 *
 * Detects PII based on:
 *   1. Field/key names matching known PII patterns (email, phone, name, address, etc.)
 *   2. Event names associated with form submissions (which often capture PII)
 *   3. Parameter values that look like email/phone (regex match)
 *
 * Returns an array of PiiWarning objects to be surfaced in the frontend
 * output view and included in the generated implementation guide.
 */

import type { PlanningRecommendation } from '@/types/planning';
import type { DataLayerSpecOutput } from './generators/dataLayerSpecGenerator';

// ── Types ──────────────────────────────────────────────────────────────────────

export type PiiSeverity = 'high' | 'medium' | 'info';

export interface PiiWarning {
  severity: PiiSeverity;
  field: string;
  event_name: string;
  page_url?: string;
  message: string;
  recommendation: string;
}

// ── PII field name patterns ────────────────────────────────────────────────────

const HIGH_RISK_FIELD_PATTERNS = [
  /\bemail\b/i,
  /\bphone\b/i,
  /\bmobile\b/i,
  /\btelephone\b/i,
  /\bssn\b/i,
  /\bsocial.?security\b/i,
  /\bcredit.?card\b/i,
  /\bcard.?number\b/i,
  /\bpassword\b/i,
  /\bcvv\b/i,
  /\bpin\b/i,
];

const MEDIUM_RISK_FIELD_PATTERNS = [
  /\bfirst.?name\b/i,
  /\blast.?name\b/i,
  /\bfull.?name\b/i,
  /\buser.?name\b/i,
  /\baddress\b/i,
  /\bstreet\b/i,
  /\bzip\b/i,
  /\bpostal\b/i,
  /\bcity\b/i,
  /\bcountry\b/i,
  /\bdate.?of.?birth\b/i,
  /\bdob\b/i,
  /\bage\b/i,
  /\bgender\b/i,
  /\bip.?address\b/i,
  /\buser.?id\b/i,
  /\bcustomer.?id\b/i,
  /\baccount.?id\b/i,
];

// ── Value-level PII patterns (regex on example values) ────────────────────────

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[\d\s\-().]{7,20}$/;

// ── PII-adjacent action types (forms typically capture PII) ───────────────────

const PII_ADJACENT_ACTIONS = new Set([
  'generate_lead',
  'sign_up',
  'subscribe',
  'checkout_step',
  'purchase',
  'login',
  'create_account',
  'form_submit',
]);

// ── Main detection function ───────────────────────────────────────────────────

export function detectPiiWarnings(
  recommendations: PlanningRecommendation[],
  spec?: DataLayerSpecOutput,
): PiiWarning[] {
  const warnings: PiiWarning[] = [];

  for (const rec of recommendations) {
    const eventName = rec.event_name;
    const params = [
      ...((rec.required_params as unknown as Array<{ param_key: string; example?: string }>) ?? []),
      ...((rec.optional_params as unknown as Array<{ param_key: string; example?: string }>) ?? []),
    ];

    for (const param of params) {
      const key = param.param_key ?? '';
      const example = param.example ?? '';
      const eventUrl = spec?.machine_spec.pages.find(p =>
        p.events.some(e => e.event_name === eventName)
      )?.page_url;

      // Check key name against high-risk patterns
      for (const pattern of HIGH_RISK_FIELD_PATTERNS) {
        if (pattern.test(key)) {
          warnings.push({
            severity: 'high',
            field: key,
            event_name: eventName,
            page_url: eventUrl,
            message: `The field "${key}" on the "${eventName}" event may contain personally identifiable information.`,
            recommendation: `Ensure this field is hashed (SHA-256) before sending to third-party platforms. Atlas's CAPI Module handles hashing automatically — consider connecting it. Raw PII must never appear in browser-side dataLayer pushes or GTM tags.`,
          });
          break;
        }
      }

      // Check key name against medium-risk patterns
      for (const pattern of MEDIUM_RISK_FIELD_PATTERNS) {
        if (pattern.test(key)) {
          warnings.push({
            severity: 'medium',
            field: key,
            event_name: eventName,
            page_url: eventUrl,
            message: `The field "${key}" on the "${eventName}" event may contain personal data subject to privacy regulations.`,
            recommendation: `Review whether this field needs to be sent to ad platforms. If it's required for attribution, ensure it is hashed or pseudonymised. Store only what is necessary.`,
          });
          break;
        }
      }

      // Check example values for email/phone patterns
      if (example && EMAIL_PATTERN.test(example.trim())) {
        warnings.push({
          severity: 'high',
          field: key,
          event_name: eventName,
          page_url: eventUrl,
          message: `The field "${key}" appears to contain an email address in the example value (${example}).`,
          recommendation: `The example value looks like a real email address. Use a clearly fake placeholder (e.g., "user@example.com") in your spec. For sending email to ad platforms, always use SHA-256 hashing via Atlas CAPI.`,
        });
      } else if (example && PHONE_PATTERN.test(example.trim())) {
        warnings.push({
          severity: 'high',
          field: key,
          event_name: eventName,
          page_url: eventUrl,
          message: `The field "${key}" appears to contain a phone number in the example value (${example}).`,
          recommendation: `Use a clearly fake placeholder (e.g., "+1-555-000-0000") in your spec. For sending phone numbers to ad platforms, always use SHA-256 hashing via Atlas CAPI.`,
        });
      }
    }

    // Surface an informational warning for PII-adjacent events
    if (PII_ADJACENT_ACTIONS.has(rec.action_type)) {
      const paramKeys = params.map(p => p.param_key ?? '');
      const hasPiiField = paramKeys.some(k =>
        [...HIGH_RISK_FIELD_PATTERNS, ...MEDIUM_RISK_FIELD_PATTERNS].some(p => p.test(k))
      );
      if (!hasPiiField) {
        warnings.push({
          severity: 'info',
          field: '(event)',
          event_name: eventName,
          message: `The "${eventName}" event typically involves user data (name, email, phone). Verify that no PII is being pushed to the dataLayer in plain text.`,
          recommendation: `If your implementation captures user details at this stage, ensure that only hashed or pseudonymised values are sent to ad platforms. Use Atlas CAPI's automatic hashing to handle this safely.`,
        });
      }
    }
  }

  // Deduplicate: same field + event_name
  const seen = new Set<string>();
  return warnings.filter(w => {
    const key = `${w.event_name}::${w.field}::${w.severity}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
