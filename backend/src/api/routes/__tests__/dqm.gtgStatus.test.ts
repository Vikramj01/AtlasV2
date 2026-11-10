import { describe, it, expect, vi } from 'vitest';

vi.mock('@/services/database/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock('@/api/middleware/authMiddleware', () => ({ authMiddleware: (_q: unknown, _r: unknown, n: () => void) => n() }));

import { worstLatestGtgStatus } from '../dqm';

describe('worstLatestGtgStatus', () => {
  it('unknown when nothing has been probed', () => expect(worstLatestGtgStatus([])).toBe('unknown'));
  it('uses only each endpoint latest check (rows are newest-first): an old failure no longer counts', () => {
    expect(worstLatestGtgStatus([
      { check_status: 'pass', endpoint_id: 'e1' },
      { check_status: 'fail', endpoint_id: 'e1' },
    ])).toBe('pass');
  });
  it('worst across endpoints wins', () => {
    expect(worstLatestGtgStatus([
      { check_status: 'pass', endpoint_id: 'e1' },
      { check_status: 'degraded', endpoint_id: 'e2' },
      { check_status: 'fail', endpoint_id: 'e3' },
    ])).toBe('fail');
  });
});
