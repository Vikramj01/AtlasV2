/** Junk gate DQM alert (GA4 Admin / L11 / Junk Gate PRD §C.10, C3). */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const q = vi.hoisted(() => ({ listActiveGateConfigs: vi.fn(), listRecentVerdicts: vi.fn(), countHoldsExpiringBefore: vi.fn() }));
vi.mock('@/services/database/junkGateQueries', () => q);

import { evaluateJunkGateAlert } from '../dqmAlertEvaluator';
import { computeJunkGateAlertSignals, flaggedPercent, MIN_EVALUATED, NEAR_TIMEOUT_MS } from '../junkGateMonitor';

const input = (over = {}) => ({ holdsNearTimeout: 0, spikeClients: 0, worstFlaggedPct: 0, thresholdPct: 30, existingAlertActive: false, ...over });

describe('evaluateJunkGateAlert', () => {
  it('does nothing when there is nothing to flag, and resolves an active alert', () => {
    expect(evaluateJunkGateAlert(input()).decision).toBe('none');
    expect(evaluateJunkGateAlert(input({ existingAlertActive: true })).decision).toBe('resolve');
  });
  it('holds nearing timeout → warning, names the automatic outcome', () => {
    const r = evaluateJunkGateAlert(input({ holdsNearTimeout: 3 }));
    expect(r).toMatchObject({ decision: 'open', severity: 'warning', title: 'Junk Gate: Held Conversions Awaiting Review' });
    expect(r.message).toContain('3 held conversions are due');
    expect(r.message).toContain('released or dropped automatically');
  });
  it('a spike → warning that says it could be an attack OR a misfiring rule', () => {
    const r = evaluateJunkGateAlert(input({ spikeClients: 1, worstFlaggedPct: 64, thresholdPct: 30 }));
    expect(r.title).toBe('Junk Gate: Flagged-Rate Spike');
    expect(r.message).toMatch(/spam or bot wave, or a rule flagging good leads/);
    expect(r.message).toContain('more than 30%');
    expect(r.message).toContain('64%');
  });
  it('both conditions produce ONE combined alert; an active one updates instead of re-opening', () => {
    const open = evaluateJunkGateAlert(input({ holdsNearTimeout: 1, spikeClients: 2, worstFlaggedPct: 50 }));
    expect(open.title).toBe('Junk Gate: Holds Awaiting Review and Flagged-Rate Spike');
    expect(evaluateJunkGateAlert(input({ holdsNearTimeout: 1, existingAlertActive: true })).decision).toBe('update');
  });
  it('singular wording for one hold / one client', () => {
    const r = evaluateJunkGateAlert(input({ holdsNearTimeout: 1, spikeClients: 1, worstFlaggedPct: 40 }));
    expect(r.message).toContain('1 held conversion is due');
    expect(r.message).toContain('1 client has had');
  });
});

describe('computeJunkGateAlertSignals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    q.countHoldsExpiringBefore.mockResolvedValue(0);
  });
  const verdicts = (flagged: number, clean: number) => [...Array(flagged).fill('junk'), ...Array(clean).fill('clean')];

  it('returns null when the org has no active gate config (the caller resolves any open alert)', async () => {
    q.listActiveGateConfigs.mockResolvedValue([]);
    expect(await computeJunkGateAlertSignals('org-1', false)).toBeNull();
  });

  it('a spike needs the flagged share above the client threshold AND enough events to be a rate', async () => {
    q.listActiveGateConfigs.mockResolvedValue([
      { client_id: 'c-spike', mode: 'observe', hold_rate_alert_pct: 30 },
      { client_id: 'c-tiny', mode: 'observe', hold_rate_alert_pct: 30 },
      { client_id: 'c-ok', mode: 'enforce', hold_rate_alert_pct: 30 },
    ]);
    q.listRecentVerdicts.mockImplementation(async (_o: string, c: string) =>
      c === 'c-spike' ? verdicts(15, 25) : c === 'c-tiny' ? verdicts(MIN_EVALUATED - 6, 0) : verdicts(5, 35));
    const s = await computeJunkGateAlertSignals('org-1', false);
    expect(s).toMatchObject({ spikeClients: 1, worstFlaggedPct: 38, thresholdPct: 30, holdsNearTimeout: 0 });
  });

  it("uses each client's own threshold", async () => {
    q.listActiveGateConfigs.mockResolvedValue([
      { client_id: 'a', mode: 'observe', hold_rate_alert_pct: 60 },
      { client_id: 'b', mode: 'observe', hold_rate_alert_pct: null },
    ]);
    q.listRecentVerdicts.mockResolvedValue(verdicts(20, 30)); // 40%: under a's 60, over b's default 30
    const s = await computeJunkGateAlertSignals('org-1', false);
    expect(s?.spikeClients).toBe(1);
  });

  it('counts open holds expiring within the near-timeout window', async () => {
    q.listActiveGateConfigs.mockResolvedValue([{ client_id: 'a', mode: 'enforce', hold_rate_alert_pct: 30 }]);
    q.listRecentVerdicts.mockResolvedValue([]);
    q.countHoldsExpiringBefore.mockResolvedValue(4);
    const now = new Date('2026-10-08T12:00:00Z');
    const s = await computeJunkGateAlertSignals('org-1', true, now);
    expect(s).toMatchObject({ holdsNearTimeout: 4, existingAlertActive: true });
    expect(q.countHoldsExpiringBefore).toHaveBeenCalledWith('org-1', new Date(now.getTime() + NEAR_TIMEOUT_MS).toISOString());
  });

  it('flaggedPercent handles empty and mixed input', () => {
    expect(flaggedPercent([])).toBe(0);
    expect(flaggedPercent(['junk', 'suspect', 'clean', 'clean'])).toBe(50);
  });
});

describe('migration 20260923001', () => {
  const root = join(__dirname, '../../../../..');
  const sql = readFileSync(join(root, 'supabase/migrations/20260923001_junk_gate_monitoring.sql'), 'utf8');
  const list = (re: RegExp) => [...re.exec(sql)![1].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);

  it('keeps every value 20260922002 allowed and adds the junk gate ones', () => {
    const prev = readFileSync(join(root, 'supabase/migrations/20260922002_ga4_config_alerts.sql'), 'utf8');
    const prevAlerts = [...(/health_alerts_alert_type_check\s+CHECK \(alert_type IN \(([\s\S]*?)\)\);/.exec(prev)![1]).matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
    const prevChecks = [...(/dqm_run_log_check_type_check\s+CHECK \(check_type IN \(([\s\S]*?)\)\);/.exec(prev)![1]).matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
    const alerts = list(/health_alerts_alert_type_check\s+CHECK \(alert_type IN \(([\s\S]*?)\)\);/);
    const checks = list(/dqm_run_log_check_type_check\s+CHECK \(check_type IN \(([\s\S]*?)\)\);/);
    for (const a of prevAlerts) expect(alerts).toContain(a);
    for (const c of prevChecks) expect(checks).toContain(c);
    expect(alerts).toContain('dqm_junk_gate');
    expect(checks).toContain('junk_gate');
  });

  it('adds the honeypot mapping and alert-threshold columns guarded by IF EXISTS', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS honeypot_field TEXT NULL/);
    expect(sql).toMatch(/hold_rate_alert_pct integer NOT NULL DEFAULT 30/);
    expect(sql).toMatch(/FROM pg_tables WHERE schemaname = 'public' AND tablename = 'junk_gate_configs'/);
  });

  it('the orchestrator writes only a check_type the constraint allows', () => {
    const src = readFileSync(join(root, 'backend/src/services/dqm/dqmOrchestrator.ts'), 'utf8');
    expect(src).toContain("'junk_gate'");
    expect(list(/dqm_run_log_check_type_check\s+CHECK \(check_type IN \(([\s\S]*?)\)\);/)).toContain('junk_gate');
  });
});
