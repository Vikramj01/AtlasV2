/**
 * Google Tag Topology Sprint 5 — the rolled-up topology alert (AC 16) and the
 * migration's CHECK widening (AC 15).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { evaluateGoogleTagTopologyAlert } from '../dqmAlertEvaluator';

const base = { monitoredCount: 3, recombinedCount: 0, adsTagLostCount: 0 };

describe('evaluateGoogleTagTopologyAlert', () => {
  it('opens exactly one critical alert when an Ads Google tag was lost', () => {
    const r = evaluateGoogleTagTopologyAlert({ ...base, adsTagLostCount: 1, existingAlertActive: false });
    expect(r).toMatchObject({ decision: 'open', severity: 'critical', title: 'Google Ads Google Tag Missing After Split' });
    expect(r.message).toContain('1 of 3 monitored clients has lost');
  });

  it('opens a warning when destinations are combined again', () => {
    const r = evaluateGoogleTagTopologyAlert({ ...base, recombinedCount: 2, existingAlertActive: false });
    expect(r).toMatchObject({ decision: 'open', severity: 'warning', title: 'Google Tags Combined Again After Split' });
    expect(r.message).toContain('2 of 3 monitored clients show');
  });

  it('a lost Ads tag outranks re-combination', () => {
    expect(evaluateGoogleTagTopologyAlert({ ...base, recombinedCount: 1, adsTagLostCount: 1, existingAlertActive: false }).severity).toBe('critical');
  });

  it('while an alert is already active and clients are still affected it UPDATES — never opens a second one', () => {
    const r = evaluateGoogleTagTopologyAlert({ ...base, recombinedCount: 1, existingAlertActive: true });
    expect(r.decision).toBe('update');
  });

  it('resolves once every monitored client is split again', () => {
    expect(evaluateGoogleTagTopologyAlert({ ...base, existingAlertActive: true }).decision).toBe('resolve');
  });

  it('does nothing when healthy with no alert, and resolves a stale alert when nothing is monitored any more', () => {
    expect(evaluateGoogleTagTopologyAlert({ ...base, existingAlertActive: false }).decision).toBe('none');
    expect(evaluateGoogleTagTopologyAlert({ monitoredCount: 0, recombinedCount: 0, adsTagLostCount: 0, existingAlertActive: false }).decision).toBe('none');
    expect(evaluateGoogleTagTopologyAlert({ monitoredCount: 0, recombinedCount: 0, adsTagLostCount: 0, existingAlertActive: true }).decision).toBe('resolve');
  });

  it('pluralises the client count correctly', () => {
    expect(evaluateGoogleTagTopologyAlert({ monitoredCount: 1, recombinedCount: 1, adsTagLostCount: 0, existingAlertActive: false }).message).toContain('1 of 1 monitored client shows');
    expect(evaluateGoogleTagTopologyAlert({ monitoredCount: 1, recombinedCount: 0, adsTagLostCount: 1, existingAlertActive: false }).message).toContain('1 of 1 monitored client has lost');
    expect(evaluateGoogleTagTopologyAlert({ monitoredCount: 3, recombinedCount: 0, adsTagLostCount: 2, existingAlertActive: false }).message).toContain('2 of 3 monitored clients have lost');
  });
});

// AC 15. The live CHECK can't be inserted against until the migration is applied,
// so this is a static guard against the dqm_sgtm failure mode (an AlertType the
// shared CHECK never allowed, silently throwing on every createAlert()): the
// migration's lists must contain every AlertType the code can write.
describe('migration 20260921003 CHECK widening (AC 15)', () => {
  const root = join(__dirname, '../../../../..');
  const sql = readFileSync(join(root, 'supabase/migrations/20260921003_google_tag_topology_monitoring.sql'), 'utf8');

  function listIn(constraint: string): string[] {
    const m = new RegExp(`ADD CONSTRAINT ${constraint}\\s+CHECK \\(([\\s\\S]*?)\\);`).exec(sql);
    if (!m) throw new Error(`constraint ${constraint} not found in migration`);
    return [...m[1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]);
  }

  it('health_alerts_alert_type_check allows every AlertType in types/health.ts, including dqm_google_tag_topology', () => {
    // The CHECK is re-created by each migration that adds an AlertType; the NEWEST one
    // (20260922002, ga4_config_changed) is what must cover every type the code can write,
    // and must still keep dqm_google_tag_topology from this migration.
    const latest = readFileSync(join(root, 'supabase/migrations/20260922002_ga4_config_alerts.sql'), 'utf8');
    const m = /ADD CONSTRAINT health_alerts_alert_type_check\s+CHECK \(([\s\S]*?)\);/.exec(latest)!;
    const allowed = [...m[1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]);
    const types = readFileSync(join(root, 'backend/src/types/health.ts'), 'utf8');
    const union = /export type AlertType =([\s\S]*?);/.exec(types)![1];
    const codeTypes = [...union.matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]);
    expect(allowed).toContain('dqm_google_tag_topology');
    expect(allowed).toContain('ga4_config_changed');
    for (const t of codeTypes) expect(allowed).toContain(t);
    // The run-log check_type the orchestrator writes for this alert is allowed too.
    const runLog = /ADD CONSTRAINT dqm_run_log_check_type_check\s+CHECK \(([\s\S]*?)\);/.exec(latest)!;
    expect([...runLog[1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1])).toContain('ga4_config');
  });

  it('keeps every live health_alerts type read before the migration was written', () => {
    const live = ['capi_delivery', 'tag_firing', 'consent_missing', 'no_recent_audit', 'capi_not_configured', 'recon_critical_finding', 'recon_brief_misaligned', 'connection_expired', 'dqm_gtg', 'dqm_dma', 'dqm_sgtm', 'dqm_google_delivery', 'dqm_outcome_sync'];
    const allowed = listIn('health_alerts_alert_type_check');
    for (const t of live) expect(allowed).toContain(t);
  });

  it('dqm_run_log_check_type_check keeps the live values and adds google_tag_topology', () => {
    const allowed = listIn('dqm_run_log_check_type_check');
    for (const t of ['gtg', 'dma', 'sgtm', 'meta_emq', 'outcome_sync']) expect(allowed).toContain(t);
    expect(allowed).toContain('google_tag_topology');
  });

  it('air_insight_correlations factor_type keeps the four live values and adds tracking_change', () => {
    const allowed = listIn('air_insight_correlations_factor_type_check');
    for (const t of ['dqm_alert', 'cse_signal_change', 'andromeda_score_drop', 'bse_delivery_failure']) expect(allowed).toContain(t);
    expect(allowed).toContain('tracking_change');
  });

  it('replaces the read-all policy so client-scoped discontinuities are not readable by every tenant', () => {
    expect(sql).toContain('DROP POLICY IF EXISTS "platform_discontinuities: read all"');
    expect(sql).toMatch(/CREATE POLICY platform_discontinuities_read[\s\S]*kind = 'platform'[\s\S]*organization_id = auth\.uid\(\)/);
    // Ignore comments: the header legitimately quotes the old policy's USING (true).
    const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(code).not.toMatch(/USING \(true\)/);
  });
});
