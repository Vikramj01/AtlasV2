/** /api/junk-gate — config + review queue + release/reject (PRD §C.8–C.9, C2). */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const q = {
  clientBelongsToOrg: vi.fn(), getFullJunkGateConfig: vi.fn(), upsertJunkGateConfig: vi.fn(),
  listHolds: vi.fn(), listProvidersForClient: vi.fn(), listMetricRows: vi.fn(),
};
vi.mock('@/services/database/junkGateQueries', () => ({
  clientBelongsToOrg: (...a: unknown[]) => q.clientBelongsToOrg(...a),
  getFullJunkGateConfig: (...a: unknown[]) => q.getFullJunkGateConfig(...a),
  upsertJunkGateConfig: (...a: unknown[]) => q.upsertJunkGateConfig(...a),
  listHolds: (...a: unknown[]) => q.listHolds(...a),
  listProvidersForClient: (...a: unknown[]) => q.listProvidersForClient(...a),
  listMetricRows: (...a: unknown[]) => q.listMetricRows(...a),
}));
const release = vi.fn();
const reject = vi.fn();
vi.mock('@/services/capi/junkGate/release', () => ({
  releaseHold: (...a: unknown[]) => release(...a), rejectHold: (...a: unknown[]) => reject(...a),
}));
const planGuardSpy = vi.hoisted(() => vi.fn());
vi.mock('@/api/middleware/authMiddleware', () => ({ authMiddleware: (_r: any, _s: any, n: any) => n() }));
vi.mock('@/api/middleware/planGuard', () => ({ planGuard: (min: string) => { planGuardSpy(min); return (_r: any, _s: any, n: any) => n(); } }));
vi.mock('@/utils/apiError', () => ({ sendInternalError: (res: any) => res.status(500).json({ error: 'Internal server error' }) }));

import { junkGateRouter } from '../junkGate';

// planGuard() is called while the router module loads; capture before beforeEach clears the spy.
const planGuardCalls = planGuardSpy.mock.calls.map((c) => c[0]);

const CLIENT = '11111111-1111-4111-8111-111111111111';
const HOLD = '22222222-2222-4222-8222-222222222222';
const app = () => {
  const a = express();
  a.use((req: any, _res: any, next: any) => { req.user = { id: 'org-1', email: 'u@test.com', plan: 'pro', isSuperAdmin: false }; next(); });
  a.use(express.json());
  a.use('/api/junk-gate', junkGateRouter);
  return request(a);
};

beforeEach(() => {
  vi.clearAllMocks();
  q.clientBelongsToOrg.mockResolvedValue(true);
  q.getFullJunkGateConfig.mockResolvedValue(null);
  q.listProvidersForClient.mockResolvedValue(['meta']);
});

it('is gated to the pro plan', () => { expect(planGuardCalls).toEqual(['pro']); });

describe('GET /config', () => {
  it('returns defaults (observe, release-on-timeout) when nothing is saved, with the clamp ceiling', async () => {
    const r = await app().get(`/api/junk-gate/config?client_id=${CLIENT}`);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ saved: false, hold_ceiling_hours: 156, timeout_will_clamp: false });
    expect(r.body.data.config).toMatchObject({ mode: 'observe', timeout_action: 'release', hold_timeout_hours: 24 });
  });
  it("404s for another org's client and 400s without client_id", async () => {
    q.clientBelongsToOrg.mockResolvedValue(false);
    expect((await app().get(`/api/junk-gate/config?client_id=${CLIENT}`)).status).toBe(404);
    expect((await app().get('/api/junk-gate/config')).status).toBe(400);
  });
});

describe('PUT /config', () => {
  it('saves a valid config and returns the resolved view', async () => {
    q.upsertJunkGateConfig.mockResolvedValue({});
    q.getFullJunkGateConfig.mockResolvedValue({ mode: 'enforce', hold_timeout_hours: 48, timeout_action: 'drop' });
    const r = await app().put('/api/junk-gate/config').send({ client_id: CLIENT, mode: 'enforce', hold_timeout_hours: 48, timeout_action: 'drop' });
    expect(r.status).toBe(200);
    expect(q.upsertJunkGateConfig).toHaveBeenCalledWith('org-1', { client_id: CLIENT, mode: 'enforce', hold_timeout_hours: 48, timeout_action: 'drop' });
    expect(r.body.data.config).toMatchObject({ mode: 'enforce', hold_timeout_hours: 48, timeout_action: 'drop' });
  });
  it.each([
    [{ mode: 'yolo' }], [{ hold_timeout_hours: 0 }], [{ hold_timeout_hours: 73 }], [{ timeout_action: 'hold' }],
    [{ action_junk: 'nuke' }], [{ rule_flags: { NOT_A_RULE: true } }], [{ organization_id: 'evil' }],
  ])('rejects %j', async (body) => {
    const r = await app().put('/api/junk-gate/config').send({ client_id: CLIENT, ...body });
    expect(r.status).toBe(400);
    expect(q.upsertJunkGateConfig).not.toHaveBeenCalled();
  });
  it("404s for another org's client without writing", async () => {
    q.clientBelongsToOrg.mockResolvedValue(false);
    expect((await app().put('/api/junk-gate/config').send({ client_id: CLIENT, mode: 'enforce' })).status).toBe(404);
    expect(q.upsertJunkGateConfig).not.toHaveBeenCalled();
  });
});

describe('GET /holds', () => {
  const row = (over = {}) => ({
    id: HOLD, client_id: CLIENT, event_name: 'generate_lead', event_time: '2026-10-07T10:00:00Z', verdict: 'junk', status: 'held',
    rule_hits: [{ rule_id: 'JC_EMAIL_DISPOSABLE', class: 'soft', evidence: 'domain mailinator.com' }], delivery_class: 'hybrid',
    expires_at: new Date(Date.now() + 3600_000).toISOString(), timeout_hours_applied: 24, timeout_clamped: false,
    decided_at: null, created_at: '2026-10-07T10:00:00Z', organization_id: 'org-1', atlas_event_id: 'evt-1', provider_config_ids: ['p1'], decided_by: null, ...over,
  });
  it('returns the queue with time remaining and the delivery class, never ids that identify a person', async () => {
    q.listHolds.mockResolvedValue({ rows: [row()], total: 1 });
    const r = await app().get('/api/junk-gate/holds?status=held');
    expect(r.status).toBe(200);
    expect(r.body.data.total).toBe(1);
    const h = r.body.data.holds[0];
    expect(h).toMatchObject({ status: 'held', delivery_class: 'hybrid', would_have_held: false });
    expect(h.seconds_remaining).toBeGreaterThan(3500);
    expect(h).not.toHaveProperty('atlas_event_id');
    expect(h).not.toHaveProperty('organization_id');
    expect(q.listHolds).toHaveBeenCalledWith('org-1', expect.objectContaining({ status: ['held'] }));
  });
  it('observed rows are the read-only "would have held" log', async () => {
    q.listHolds.mockResolvedValue({ rows: [row({ status: 'observed', expires_at: null })], total: 1 });
    const h = (await app().get('/api/junk-gate/holds?status=observed')).body.data.holds[0];
    expect(h).toMatchObject({ would_have_held: true, seconds_remaining: null });
  });
  it('ignores unknown statuses instead of passing them to the query', async () => {
    q.listHolds.mockResolvedValue({ rows: [], total: 0 });
    await app().get('/api/junk-gate/holds?status=held,bogus');
    expect(q.listHolds).toHaveBeenCalledWith('org-1', expect.objectContaining({ status: ['held'] }));
  });
});

describe('release / reject', () => {
  it('release passes the org and the acting user, and returns the result', async () => {
    release.mockResolvedValue({ outcome: 'done', status: 'released', delivered: 2, failed: 0 });
    const r = await app().post(`/api/junk-gate/holds/${HOLD}/release`);
    expect(r.status).toBe(200);
    expect(release).toHaveBeenCalledWith(HOLD, 'org-1', 'org-1');
    expect(r.body.data).toMatchObject({ delivered: 2 });
  });
  it('409 when the hold was already decided, 404 when unknown', async () => {
    release.mockResolvedValue({ outcome: 'not_held' });
    expect((await app().post(`/api/junk-gate/holds/${HOLD}/release`)).status).toBe(409);
    reject.mockResolvedValue({ outcome: 'not_found' });
    expect((await app().post(`/api/junk-gate/holds/${HOLD}/reject`)).status).toBe(404);
  });
  it('rejects a malformed id', async () => {
    expect((await app().post('/api/junk-gate/holds/not-a-uuid/release')).status).toBe(400);
    expect(release).not.toHaveBeenCalled();
  });
  it('bulk processes each id and reports per-item outcomes', async () => {
    release.mockResolvedValueOnce({ outcome: 'done', status: 'released' }).mockResolvedValueOnce({ outcome: 'not_held' });
    const other = '33333333-3333-4333-8333-333333333333';
    const r = await app().post('/api/junk-gate/holds/bulk').send({ ids: [HOLD, other], action: 'release' });
    expect(r.status).toBe(200);
    expect(r.body.data.done).toBe(1);
    expect(r.body.data.results.map((x: any) => x.outcome)).toEqual(['done', 'not_held']);
  });
  it('bulk validates: empty, too many, bad action', async () => {
    expect((await app().post('/api/junk-gate/holds/bulk').send({ ids: [], action: 'release' })).status).toBe(400);
    expect((await app().post('/api/junk-gate/holds/bulk').send({ ids: [HOLD], action: 'delete' })).status).toBe(400);
    const many = Array.from({ length: 101 }, () => HOLD);
    expect((await app().post('/api/junk-gate/holds/bulk').send({ ids: many, action: 'reject' })).status).toBe(400);
  });
});

describe('C3 config fields', () => {
  it('accepts min_submit_ms and hold_rate_alert_pct and the new rule flags', async () => {
    q.upsertJunkGateConfig.mockResolvedValue({});
    const body = { client_id: CLIENT, thresholds: { min_submit_ms: 3000 }, hold_rate_alert_pct: 45, rule_flags: { JC_SUBMIT_TOO_FAST: false, JC_HONEYPOT_FILLED: true } };
    const r = await app().put('/api/junk-gate/config').send(body);
    expect(r.status).toBe(200);
    expect(q.upsertJunkGateConfig).toHaveBeenCalledWith('org-1', body);
  });
  it.each([[{ thresholds: { min_submit_ms: 50 } }], [{ thresholds: { min_submit_ms: 61_000 } }], [{ hold_rate_alert_pct: 0 }], [{ hold_rate_alert_pct: 101 }], [{ hold_rate_alert_pct: 12.5 }]])(
    'rejects %j', async (body) => {
      expect((await app().put('/api/junk-gate/config').send({ client_id: CLIENT, ...body })).status).toBe(400);
      expect(q.upsertJunkGateConfig).not.toHaveBeenCalled();
    });
});

describe('GET /metrics', () => {
  it('computes metrics for the window from the client rows', async () => {
    q.listMetricRows.mockResolvedValue({
      rows: [
        { verdict: 'junk', status: 'released', rule_hits: [{ rule_id: 'JC_SUBMIT_TOO_FAST' }] },
        { verdict: 'clean', status: 'observed', rule_hits: [] },
      ],
      truncated: false,
    });
    const r = await app().get(`/api/junk-gate/metrics?client_id=${CLIENT}&days=7`);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ window_days: 7, evaluated: 2, flagged: 1, held: 1, reviewed_released: 1, overturn_rate: 1 });
    expect(q.listMetricRows).toHaveBeenCalledWith('org-1', CLIENT, expect.any(String));
  });
  it('defaults to 30 days, and validates client_id / days', async () => {
    q.listMetricRows.mockResolvedValue({ rows: [], truncated: false });
    expect((await app().get(`/api/junk-gate/metrics?client_id=${CLIENT}`)).body.data.window_days).toBe(30);
    expect((await app().get('/api/junk-gate/metrics')).status).toBe(400);
    expect((await app().get(`/api/junk-gate/metrics?client_id=${CLIENT}&days=400`)).status).toBe(400);
  });
  it("404s for another org's client without reading rows", async () => {
    q.clientBelongsToOrg.mockResolvedValue(false);
    expect((await app().get(`/api/junk-gate/metrics?client_id=${CLIENT}`)).status).toBe(404);
    expect(q.listMetricRows).not.toHaveBeenCalled();
  });
});

