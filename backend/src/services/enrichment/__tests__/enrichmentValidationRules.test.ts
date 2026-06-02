import { describe, it, expect } from 'vitest';
import { evaluateEnrichmentRules } from '../enrichmentValidationRules';
import type { ClientIdentityConfig, SignalEnrichmentConfig } from '@/types/enrichment';

const baseIdentity: ClientIdentityConfig = {
  id: 'id-1',
  client_id: 'client-1',
  email_field: 'user.email',
  phone_field: 'user.phone',
  first_name_field: null,
  last_name_field: null,
  postal_code_field: null,
  country_field: null,
  external_id_field: null,
  fbc_field: '_fbc',
  fbp_field: '_fbp',
  gclid_field: null,
  wbraid_field: null,
  gbraid_field: null,
  auto_capture_ip: true,
  auto_capture_ua: true,
  enabled_identifiers: ['email', 'phone', 'fbc', 'fbp'],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const purchaseEnrichment: SignalEnrichmentConfig = {
  id: 'sec-1',
  deployment_id: 'dep-1',
  signal_key: 'purchase',
  value_config: { field_path: 'ecommerce.value', include_tax: false, include_shipping: false },
  currency_config: { static_value: 'GBP', field_path: null },
  dedup_config: { field_path: 'transaction_id' },
  content_config: null,
  meta_enabled: true,
  google_enabled: true,
  linkedin_enabled: false,
  validation_score: 85,
  validation_warnings: [],
  last_validated_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('evaluateEnrichmentRules', () => {
  it('passes all error rules with full config', () => {
    const report = evaluateEnrichmentRules(baseIdentity, [purchaseEnrichment]);
    expect(report.passed).toBe(true);
    const errors = report.rule_results.filter((r) => r.severity === 'error' && !r.passed);
    expect(errors).toHaveLength(0);
  });

  it('fails IDENT_01 when email_field is null', () => {
    const identity = { ...baseIdentity, email_field: null };
    const report = evaluateEnrichmentRules(identity, [purchaseEnrichment]);
    const rule = report.rule_results.find((r) => r.rule_id === 'IDENT_01');
    expect(rule?.passed).toBe(false);
    expect(rule?.severity).toBe('error');
  });

  it('fails SIG_01 when purchase value_config is missing', () => {
    const sig = { ...purchaseEnrichment, value_config: null };
    const report = evaluateEnrichmentRules(baseIdentity, [sig]);
    const rule = report.rule_results.find((r) => r.rule_id === 'SIG_01');
    expect(rule?.passed).toBe(false);
    expect(rule?.severity).toBe('error');
  });

  it('fails SIG_03 when purchase dedup_config is missing', () => {
    const sig = { ...purchaseEnrichment, dedup_config: null };
    const report = evaluateEnrichmentRules(baseIdentity, [sig]);
    const rule = report.rule_results.find((r) => r.rule_id === 'SIG_03');
    expect(rule?.passed).toBe(false);
  });

  it('fails CROSS_01 when conversion signals enabled but no identity', () => {
    const report = evaluateEnrichmentRules(
      { ...baseIdentity, email_field: null, phone_field: null },
      [purchaseEnrichment],
    );
    const rule = report.rule_results.find((r) => r.rule_id === 'CROSS_01');
    expect(rule?.passed).toBe(false);
    expect(report.passed).toBe(false);
  });

  it('passes CROSS_01 when no conversion signals are enabled', () => {
    const sig = { ...purchaseEnrichment, meta_enabled: false, google_enabled: false };
    const report = evaluateEnrichmentRules(
      { ...baseIdentity, email_field: null, phone_field: null },
      [sig],
    );
    const rule = report.rule_results.find((r) => r.rule_id === 'CROSS_01');
    expect(rule?.passed).toBe(true);
  });

  it('fails CROSS_02 when Meta-enabled signal lacks dedup', () => {
    const sig = { ...purchaseEnrichment, meta_enabled: true, dedup_config: null };
    const report = evaluateEnrichmentRules(baseIdentity, [sig]);
    const rule = report.rule_results.find((r) => r.rule_id === 'CROSS_02');
    expect(rule?.passed).toBe(false);
    expect(rule?.severity).toBe('warning');
  });

  it('populates warnings array for all failing rules', () => {
    const report = evaluateEnrichmentRules(null, []);
    expect(report.warnings.length).toBeGreaterThan(0);
    expect(report.warnings.every((w) => w.field && w.message)).toBe(true);
  });

  it('returns 12 rule results', () => {
    const report = evaluateEnrichmentRules(baseIdentity, [purchaseEnrichment]);
    expect(report.rule_results).toHaveLength(12);
  });

  it('passes IDENT_03 when gclid_field is set but fbc/fbp are null', () => {
    const identity = { ...baseIdentity, fbc_field: null, fbp_field: null, gclid_field: 'gclid' };
    const report = evaluateEnrichmentRules(identity, []);
    const rule = report.rule_results.find((r) => r.rule_id === 'IDENT_03');
    expect(rule?.passed).toBe(true);
  });
});
