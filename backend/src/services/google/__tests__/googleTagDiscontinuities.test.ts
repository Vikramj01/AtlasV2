import { describe, it, expect } from 'vitest';
import {
  buildSplitDiscontinuityRows,
  resolveSplitEffectiveDate,
  SPLIT_AFFECTED_PLATFORMS,
  SPLIT_DISCONTINUITY_DESCRIPTION,
} from '../googleTagDiscontinuities';

describe('buildSplitDiscontinuityRows (AC 14)', () => {
  const rows = buildSplitDiscontinuityRows({ organizationId: 'org-1', clientId: 'client-1', effectiveDate: '2026-10-05' });

  it('writes one client-scoped row per affected platform (ga4, google_ads) with the PRD wording', () => {
    expect(rows.map((r) => r.platform)).toEqual([...SPLIT_AFFECTED_PLATFORMS]);
    expect(rows.map((r) => r.platform)).toEqual(['ga4', 'google_ads']);
    for (const r of rows) {
      expect(r.kind).toBe('client_tracking_change');
      expect(r.client_id).toBe('client-1');
      expect(r.organization_id).toBe('org-1');
      expect(r.effective_date).toBe('2026-10-05');
      expect(r.description).toBe(SPLIT_DISCONTINUITY_DESCRIPTION);
      expect(r.description).toContain('destinations separated, data collected per destination from this date');
    }
  });

  it('every row is shaped to satisfy the scope CHECK (client_id and organization_id both set)', () => {
    expect(rows.every((r) => r.client_id && r.organization_id && r.kind === 'client_tracking_change')).toBe(true);
  });
});

describe('resolveSplitEffectiveDate', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  const planCreatedAt = new Date('2026-10-01T09:00:00Z');

  it('defaults to the verification date', () => {
    expect(resolveSplitEffectiveDate({ planCreatedAt, now })).toEqual({ date: '2026-10-10' });
  });

  it('accepts an earlier operator-supplied split date on or after the plan was created', () => {
    expect(resolveSplitEffectiveDate({ splitDate: '2026-10-05', planCreatedAt, now })).toEqual({ date: '2026-10-05' });
    expect(resolveSplitEffectiveDate({ splitDate: '2026-10-01', planCreatedAt, now })).toEqual({ date: '2026-10-01' });
  });

  it('refuses a future date, a date before the plan, and malformed input', () => {
    expect(resolveSplitEffectiveDate({ splitDate: '2026-10-11', planCreatedAt, now })).toEqual({ error: 'split_date cannot be in the future' });
    expect(resolveSplitEffectiveDate({ splitDate: '2026-09-30', planCreatedAt, now })).toEqual({ error: 'split_date cannot be before the split plan was created' });
    expect('error' in resolveSplitEffectiveDate({ splitDate: '10/05/2026', planCreatedAt, now })).toBe(true);
    expect('error' in resolveSplitEffectiveDate({ splitDate: '2026-13-45', planCreatedAt, now })).toBe(true);
  });
});
