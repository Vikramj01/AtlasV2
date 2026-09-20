import { describe, it, expect } from 'vitest';
import { OUTCOME_CONTRACT_VERSION, validateOutcomeRecord, resolveContractIdentity } from '../contract';

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    source_record_id: 'deal-123',
    source_stage_id: 'closedwon',
    stage_changed_at: '2026-09-20T12:00:00Z',
    identity: { gclid: 'test_gclid_123' },
    ...overrides,
  };
}

describe('OUTCOME_CONTRACT_VERSION', () => {
  it('is exported as a semver string', () => {
    expect(OUTCOME_CONTRACT_VERSION).toBe('1.0.0');
    expect(OUTCOME_CONTRACT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('validateOutcomeRecord — valid payloads', () => {
  it('accepts the minimal valid record (required fields + one identity key)', () => {
    const result = validateOutcomeRecord(validPayload());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.record?.source_record_id).toBe('deal-123');
  });

  it('accepts every optional field populated', () => {
    const result = validateOutcomeRecord(validPayload({
      identity: { gclid: 'g1', fbclid: 'f1', email: 'sha256hash', atlas_event_id: 'evt-1' },
      value: 499.99,
      currency: 'USD',
      source_object: 'deal',
    }));
    expect(result.valid).toBe(true);
    expect(result.record?.value).toBe(499.99);
    expect(result.record?.currency).toBe('USD');
  });

  it('accepts a stage_changed_at with a non-Z timezone offset', () => {
    const result = validateOutcomeRecord(validPayload({ stage_changed_at: '2026-09-20T12:00:00+02:00' }));
    expect(result.valid).toBe(true);
  });

  it('accepts source_object as an arbitrary free-form string (non-CRM sources)', () => {
    const result = validateOutcomeRecord(validPayload({ source_object: 'spreadsheet_row' }));
    expect(result.valid).toBe(true);
  });

  it('accepts identity resolved via email/phone alone, no click id', () => {
    const result = validateOutcomeRecord(validPayload({ identity: { email: 'hashedemail' } }));
    expect(result.valid).toBe(true);
  });
});

describe('validateOutcomeRecord — rejects with field-level errors, never coerces', () => {
  it('rejects a missing required field', () => {
    const payload = validPayload();
    delete (payload as Record<string, unknown>).source_record_id;
    const result = validateOutcomeRecord(payload);
    expect(result.valid).toBe(false);
    expect(result.record).toBeUndefined();
    expect(result.errors.some((e) => e.field === 'source_record_id')).toBe(true);
  });

  it('rejects an empty string for a required field rather than treating it as absent', () => {
    const result = validateOutcomeRecord(validPayload({ source_record_id: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'source_record_id')).toBe(true);
  });

  it('rejects a missing timestamp rather than inferring "now"', () => {
    const payload = validPayload();
    delete (payload as Record<string, unknown>).stage_changed_at;
    const result = validateOutcomeRecord(payload);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'stage_changed_at')).toBe(true);
  });

  it('rejects a non-ISO-8601 timestamp', () => {
    const result = validateOutcomeRecord(validPayload({ stage_changed_at: '09/20/2026' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'stage_changed_at')).toBe(true);
  });

  it('rejects an empty identity object — an outcome with no identity signal delivers nothing', () => {
    const result = validateOutcomeRecord(validPayload({ identity: {} }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'identity')).toBe(true);
  });

  it('rejects an unrecognised top-level field rather than silently dropping it', () => {
    const result = validateOutcomeRecord(validPayload({ campaign_name: 'Q3 Push' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.toLowerCase().includes('unrecognized') || e.message.toLowerCase().includes('unrecognised'))).toBe(true);
  });

  it('rejects an unrecognised identity key rather than silently dropping it', () => {
    const result = validateOutcomeRecord(validPayload({ identity: { gclid: 'g1', not_a_real_identity_key: 'x' } }));
    expect(result.valid).toBe(false);
  });

  it('rejects a non-3-letter currency code', () => {
    const result = validateOutcomeRecord(validPayload({ currency: 'US' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'currency')).toBe(true);
  });

  it('rejects a lowercase currency code rather than coercing it to uppercase', () => {
    const result = validateOutcomeRecord(validPayload({ currency: 'usd' }));
    expect(result.valid).toBe(false);
  });

  it('rejects a non-finite value', () => {
    const result = validateOutcomeRecord(validPayload({ value: Infinity }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'value')).toBe(true);
  });

  it('rejects a completely malformed payload (not an object) without throwing', () => {
    expect(() => validateOutcomeRecord('not an object')).not.toThrow();
    expect(() => validateOutcomeRecord(null)).not.toThrow();
    expect(() => validateOutcomeRecord(undefined)).not.toThrow();
    expect(validateOutcomeRecord(null).valid).toBe(false);
  });

  it('reports every violation in one pass, not just the first', () => {
    const result = validateOutcomeRecord({ identity: {} });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
  });
});

describe('resolveContractIdentity', () => {
  it('resolves to click_id when any click-id key is present', () => {
    expect(resolveContractIdentity({ gclid: 'g1' }).method).toBe('click_id');
    expect(resolveContractIdentity({ fbclid: 'f1' }).method).toBe('click_id');
    expect(resolveContractIdentity({ oppref: 'o1' }).method).toBe('click_id');
  });

  it('click_id wins even when email/phone are also present', () => {
    const result = resolveContractIdentity({ gclid: 'g1', email: 'hashed', phone: 'hashed' });
    expect(result.method).toBe('click_id');
  });

  it('resolves to hashed_email when email is present with no click id', () => {
    expect(resolveContractIdentity({ email: 'hashed-email' }).method).toBe('hashed_email');
  });

  it('email wins over phone when both are present with no click id', () => {
    expect(resolveContractIdentity({ email: 'e', phone: 'p' }).method).toBe('hashed_email');
  });

  it('resolves to hashed_phone when only phone is present', () => {
    expect(resolveContractIdentity({ phone: 'hashed-phone' }).method).toBe('hashed_phone');
  });

  it('resolves to unresolved when nothing is present', () => {
    expect(resolveContractIdentity({}).method).toBe('unresolved');
  });

  it('a bare atlas_event_id with nothing else resolves to unresolved, not click_id', () => {
    // Deliberate: see this module's own header and deliveryGate.ts's — no
    // capi_events join exists to verify a stronger inherited method, so
    // this must not silently assert Tier 1.
    const result = resolveContractIdentity({ atlas_event_id: 'evt-123' });
    expect(result.method).toBe('unresolved');
    expect(result.keys_present).toContain('event_id');
  });

  it('maps atlas_event_id to the event_id identity key, not a literal atlas_event_id key', () => {
    const result = resolveContractIdentity({ gclid: 'g1', atlas_event_id: 'evt-123' });
    expect(result.keys_present).toContain('event_id');
    expect(result.keys_present).not.toContain('atlas_event_id' as never);
    expect(result.values.event_id).toBe('evt-123');
  });

  it('keys_present lists every present identity key, not just the winning one', () => {
    const result = resolveContractIdentity({ gclid: 'g1', fbclid: 'f1', email: 'e' });
    expect(result.keys_present.sort()).toEqual(['email', 'fbclid', 'gclid'].sort());
  });

  it('values carries the raw value for every present key', () => {
    const result = resolveContractIdentity({ gclid: 'g1', email: 'e1' });
    expect(result.values).toEqual({ gclid: 'g1', email: 'e1' });
  });

  it('never includes a key with an undefined value', () => {
    const result = resolveContractIdentity({ gclid: 'g1' });
    expect(Object.keys(result.values)).toEqual(['gclid']);
  });
});
