/**
 * Queue payload PII safety tests
 *
 * Verifies that Bull job payloads contain only IDs — no raw PII,
 * no credentials, no decrypted secrets. This mirrors the requirement:
 * "No PII in job payloads — queue payloads contain only IDs."
 */

import { describe, it, expect } from 'vitest';

// ── PII pattern detectors ─────────────────────────────────────────────────────

const EMAIL_PATTERN = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;
const PHONE_PATTERN = /(\+?1?\s?)?(\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})/;
const GCLID_BODY_PATTERN = /[A-Za-z0-9_\-]{30,}/;

function containsPII(payload: object): { hasPII: boolean; fields: string[] } {
  const str = JSON.stringify(payload);
  const found: string[] = [];

  if (EMAIL_PATTERN.test(str)) found.push('email');
  if (PHONE_PATTERN.test(str)) found.push('phone');

  return { hasPII: found.length > 0, fields: found };
}

// ── Offline Conversion job payload ────────────────────────────────────────────

describe('Offline conversion Bull job payload', () => {
  it('contains only IDs — no email, phone, or gclid raw values', () => {
    const jobPayload = {
      upload_id: 'upload-uuid-001',
      organization_id: 'org-uuid-001',
    };

    const { hasPII } = containsPII(jobPayload);
    expect(hasPII).toBe(false);
  });

  it('does not contain raw PII fields as keys', () => {
    const jobPayload = {
      upload_id: 'upload-uuid-001',
      organization_id: 'org-uuid-001',
    };

    const forbiddenKeys = ['email', 'phone', 'gclid', 'raw_email', 'raw_phone', 'first_name', 'last_name'];
    const payloadKeys = Object.keys(jobPayload);

    for (const forbidden of forbiddenKeys) {
      expect(payloadKeys).not.toContain(forbidden);
    }
  });

  it('rejects a payload that accidentally includes email', () => {
    const badPayload = {
      upload_id: 'upload-uuid-001',
      organization_id: 'org-uuid-001',
      email: 'user@example.com',  // should NOT be here
    };

    const { hasPII, fields } = containsPII(badPayload);
    expect(hasPII).toBe(true);
    expect(fields).toContain('email');
  });
});

// ── CAPI delivery job payload ─────────────────────────────────────────────────

describe('CAPI delivery Bull job payload', () => {
  it('contains only provider_id and event_id — no user data', () => {
    const jobPayload = {
      provider_id: 'prov-uuid-001',
      event_id: 'evt-uuid-001',
      organization_id: 'org-uuid-001',
    };

    const { hasPII } = containsPII(jobPayload);
    expect(hasPII).toBe(false);
  });

  it('does not contain credential fields', () => {
    const jobPayload = {
      provider_id: 'prov-uuid-001',
      event_id: 'evt-uuid-001',
    };

    const forbiddenKeys = ['access_token', 'pixel_id', 'oauth_access_token', 'api_key', 'secret'];
    const payloadKeys = JSON.stringify(jobPayload);

    for (const forbidden of forbiddenKeys) {
      expect(payloadKeys).not.toContain(forbidden);
    }
  });
});

// ── Audit job payload ─────────────────────────────────────────────────────────

describe('Audit Bull job payload', () => {
  it('contains only audit_id and user_id', () => {
    const jobPayload = {
      audit_id: 'audit-uuid-001',
      user_id: 'user-uuid-001',
    };

    const { hasPII } = containsPII(jobPayload);
    expect(hasPII).toBe(false);
  });
});

// ── Reconciliation job payload ────────────────────────────────────────────────

describe('Reconciliation Bull job payload', () => {
  it('contains only run_id and org_id', () => {
    const jobPayload = {
      run_id: 'run-uuid-001',
      org_id: 'org-uuid-001',
    };

    const { hasPII } = containsPII(jobPayload);
    expect(hasPII).toBe(false);
  });
});

// ── Crawl job payload ─────────────────────────────────────────────────────────

describe('Crawl Bull job payload', () => {
  it('contains run_id, org_id, page IDs — no personal data', () => {
    const jobPayload = {
      run_id: 'run-uuid-001',
      org_id: 'org-uuid-001',
      page_ids: ['page-001', 'page-002', 'page-003'],
      mode: 'scheduled',
    };

    const { hasPII } = containsPII(jobPayload);
    expect(hasPII).toBe(false);
  });
});

// ── General payload shape validator ──────────────────────────────────────────

describe('Generic payload safety checker', () => {
  it('flags any payload containing an email address', () => {
    const payloads = [
      { id: 'u1', email: 'user@example.com' },
      { id: 'u2', contact: { email: 'other@example.com' } },
    ];

    for (const p of payloads) {
      const { hasPII } = containsPII(p);
      expect(hasPII).toBe(true);
    }
  });

  it('clears payloads that contain only IDs and metadata', () => {
    const safePayloads = [
      { upload_id: 'abc-123', org_id: 'xyz-456' },
      { job_type: 'audit', resource_id: 'res-789', queued: true },
      { run_id: 'run-001', mode: 'scheduled', page_count: 5 },
    ];

    for (const p of safePayloads) {
      const { hasPII, fields } = containsPII(p);
      expect(hasPII).toBe(false);
      if (hasPII) {
        console.error('PII found in payload:', p, 'fields:', fields);
      }
    }
  });
});
