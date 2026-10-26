/** PUT identity-config: honeypot_selector validation + preserve-on-omit semantics (junk gate follow-up to C3). */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const q = vi.hoisted(() => ({ upsert: vi.fn() }));
vi.mock('@/services/database/orgQueries', () => ({ getOrgMembership: vi.fn().mockResolvedValue({ role: 'owner' }) }));
vi.mock('@/services/database/clientQueries', () => ({ getClient: vi.fn().mockResolvedValue({ id: 'c1', organisation_id: 'org-1' }) }));
vi.mock('@/services/database/enrichmentQueries', () => ({
  upsertClientIdentityConfig: (...a: unknown[]) => q.upsert(...a),
  getClientIdentityConfig: vi.fn(), listSignalEnrichmentConfigs: vi.fn(), upsertSignalEnrichmentConfig: vi.fn(),
  updateIdentityValidation: vi.fn(), updateSignalValidation: vi.fn(), getSignalEnrichmentConfig: vi.fn(), deleteSignalEnrichmentConfig: vi.fn(),
}));
vi.mock('@/services/enrichment/enrichmentConfigService', () => ({
  computeClientEnrichmentScore: vi.fn(), validateSignalEnrichment: vi.fn(), validateFieldPathSyntax: vi.fn(),
}));
vi.mock('@/api/middleware/authMiddleware', () => ({ authMiddleware: (_r: any, _s: any, n: any) => n() }));
vi.mock('@/utils/apiError', () => ({ sendInternalError: (res: any) => res.status(500).json({ error: 'Internal server error' }) }));
vi.mock('@/utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { enrichmentRouter } from '../enrichment';

const URL = '/api/organisations/org-1/clients/c1/identity-config';
const app = () => {
  const a = express();
  a.use((req: any, _res: any, next: any) => { req.user = { id: 'u1' }; next(); });
  a.use(express.json());
  a.use('/api', enrichmentRouter);
  return request(a);
};
const body = (over: Record<string, unknown> = {}) => ({ enabled_identifiers: ['email'], ...over });

beforeEach(() => { vi.clearAllMocks(); q.upsert.mockResolvedValue({ id: 'cfg' }); });

describe('honeypot_selector on PUT identity-config', () => {
  it('saves a valid selector (trimmed)', async () => {
    const r = await app().put(URL).send(body({ honeypot_selector: '  input[name="website"] ' }));
    expect(r.status).toBe(200);
    expect(q.upsert.mock.calls[0][0]).toMatchObject({ client_id: 'c1', honeypot_selector: 'input[name="website"]' });
  });

  it.each([["x');alert(1);//"], ['</script>'], ['a`b'], ['x'.repeat(101)]])('rejects an unsafe or oversized selector %j with a 400 and does not save', async (sel) => {
    const r = await app().put(URL).send(body({ honeypot_selector: sel }));
    expect(r.status).toBe(400);
    expect(q.upsert).not.toHaveBeenCalled();
  });

  it('a blank or null selector CLEARS it (stored as null)', async () => {
    for (const v of ['', '   ', null]) {
      q.upsert.mockClear();
      expect((await app().put(URL).send(body({ honeypot_selector: v }))).status).toBe(200);
      expect(q.upsert.mock.calls[0][0].honeypot_selector).toBeNull();
    }
  });

  it('OMITTING the selector leaves the stored value alone (it is not sent to the upsert at all)', async () => {
    await app().put(URL).send(body());
    expect(q.upsert.mock.calls[0][0].honeypot_selector).toBeUndefined();
    expect(q.upsert.mock.calls[0][0].honeypot_field).toBeUndefined();
  });

  it('honeypot_field (a data path) is cleared by blank and kept distinct from the selector', async () => {
    await app().put(URL).send(body({ honeypot_field: ' form.website ', honeypot_selector: '#hp' }));
    expect(q.upsert.mock.calls[0][0]).toMatchObject({ honeypot_field: 'form.website', honeypot_selector: '#hp' });
    q.upsert.mockClear();
    await app().put(URL).send(body({ honeypot_field: '' }));
    expect(q.upsert.mock.calls[0][0].honeypot_field).toBeNull();
  });
});
