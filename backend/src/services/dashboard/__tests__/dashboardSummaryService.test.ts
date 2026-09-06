/**
 * dashboardSummaryService tests — Sprint 1 (Unified Cross-Signal Dashboard).
 *
 * Covers: DQM check_status -> severity mapping, DMA severity heuristic,
 * health_level escalation (DQM/CAPI signals can only escalate, never
 * de-escalate a findings-based level), and per-client CAPI match
 * quality/dedup rate derived via client_identity_configs -> capi_providers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/database/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}));

import { supabaseAdmin } from '@/services/database/supabase';
import {
  checkStatusSeverity,
  dmaSeverity,
  worstDqmSeverity,
  getClientSummaries,
} from '../dashboardSummaryService';

// ── Chain mock ────────────────────────────────────────────────────────────────

function makeChain(data: unknown[] = []): any {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'gte', 'lte', 'is', 'order', 'upsert']) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.limit = vi.fn().mockResolvedValue({ data, error: null });
  chain.single = vi.fn().mockResolvedValue({ data: data[0] ?? null, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: data[0] ?? null, error: null });
  chain.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
    Promise.resolve({ data, error: null }).then(resolve);
  return chain;
}

function mockTables(tables: Record<string, unknown[]>) {
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => makeChain(tables[table] ?? []) as any);
}

// ── checkStatusSeverity / dmaSeverity / worstDqmSeverity ─────────────────────

describe('checkStatusSeverity', () => {
  it('maps fail to critical', () => expect(checkStatusSeverity('fail')).toBe('critical'));
  it('maps timeout/error to high', () => {
    expect(checkStatusSeverity('timeout')).toBe('high');
    expect(checkStatusSeverity('error')).toBe('high');
  });
  it('maps degraded to medium', () => expect(checkStatusSeverity('degraded')).toBe('medium'));
  it('maps pass/unknown/undefined to null', () => {
    expect(checkStatusSeverity('pass')).toBeNull();
    expect(checkStatusSeverity('not-applicable')).toBeNull();
    expect(checkStatusSeverity(undefined)).toBeNull();
  });
});

describe('dmaSeverity', () => {
  it('returns null when no state', () => expect(dmaSeverity(undefined)).toBeNull());
  it('returns high when consecutive_failures > 0', () => {
    expect(dmaSeverity({ consecutive_failures: 2, avg_match_rate: 80 })).toBe('high');
  });
  it('returns medium when avg_match_rate is below the low-match-rate threshold', () => {
    expect(dmaSeverity({ consecutive_failures: 0, avg_match_rate: 15 })).toBe('medium');
  });
  it('returns null when healthy', () => {
    expect(dmaSeverity({ consecutive_failures: 0, avg_match_rate: 80 })).toBeNull();
  });
});

describe('worstDqmSeverity', () => {
  it('picks the highest-ranked severity among the inputs', () => {
    expect(worstDqmSeverity('medium', 'critical', null)).toBe('critical');
    expect(worstDqmSeverity('medium', 'high', null)).toBe('high');
    expect(worstDqmSeverity(null, null)).toBeNull();
  });
});

// ── getClientSummaries ───────────────────────────────────────────────────────

describe('getClientSummaries', () => {
  beforeEach(() => vi.clearAllMocks());

  it('folds DQM alerts and CAPI match quality into health_level without downgrading existing severity', async () => {
    const clients = [
      { id: 'c1', name: 'Alpha' }, // baseline healthy
      { id: 'c2', name: 'Beta' },  // 0 findings, but DQM sgtm 'fail' -> escalates to critical
      { id: 'c3', name: 'Gamma' }, // 5 findings -> already critical; DQM clean must not downgrade it
      { id: 'c4', name: 'Delta' }, // 0 findings, clean DQM, but low CAPI match quality -> warning
    ];

    mockTables({
      clients,
      client_platforms: [],
      deployments: [
        { client_id: 'c1', last_generated_at: '2026-08-01T00:00:00Z' },
        { client_id: 'c2', last_generated_at: '2026-08-01T00:00:00Z' },
        { client_id: 'c3', last_generated_at: '2026-08-01T00:00:00Z' },
        { client_id: 'c4', last_generated_at: '2026-08-01T00:00:00Z' },
      ],
      audit_findings: [
        { client_id: 'c3' }, { client_id: 'c3' }, { client_id: 'c3' },
      ],
      reconciliation_findings: [
        { client_id: 'c3' }, { client_id: 'c3' },
      ],
      dqm_sgtm_checks: [
        { client_id: 'c2', check_status: 'fail', checked_at: '2026-09-01T00:00:00Z' },
        { client_id: 'c3', check_status: 'pass', checked_at: '2026-09-01T00:00:00Z' },
      ],
      dqm_gtg_checks: [],
      dqm_dma_poll_state: [],
      client_identity_configs: [
        { id: 'config-4', client_id: 'c4' },
      ],
      capi_providers: [
        { id: 'provider-4a', identity_config_id: 'config-4' },
      ],
      capi_events: [
        { provider_config_id: 'provider-4a', match_quality_score: 2, dedup_status: 'hit' },
        { provider_config_id: 'provider-4a', match_quality_score: 4, dedup_status: 'miss' },
        { provider_config_id: 'provider-4a', match_quality_score: null, dedup_status: 'hit' },
      ],
    });

    const summaries = await getClientSummaries('org-1');
    const byId = Object.fromEntries(summaries.map((s) => [s.id, s]));

    // c1: untouched baseline
    expect(byId.c1.health_level).toBe('healthy');
    expect(byId.c1.dqm_alert_count).toBe(0);
    expect(byId.c1.dqm_worst_severity).toBeNull();
    expect(byId.c1.capi_match_quality_7d).toBeNull();
    expect(byId.c1.capi_dedup_rate_7d).toBeNull();

    // c2: DQM escalates a findings-clean client to critical
    expect(byId.c2.open_findings_count).toBe(0);
    expect(byId.c2.dqm_worst_severity).toBe('critical');
    expect(byId.c2.dqm_alert_count).toBe(1);
    expect(byId.c2.health_level).toBe('critical');

    // c3: already critical from findings; clean DQM must not downgrade it
    expect(byId.c3.open_findings_count).toBe(5);
    expect(byId.c3.dqm_worst_severity).toBeNull();
    expect(byId.c3.health_level).toBe('critical');

    // c4: low CAPI match quality escalates an otherwise-healthy client to warning
    expect(byId.c4.capi_match_quality_7d).toBe(3); // avg(2, 4), null score excluded
    expect(byId.c4.capi_dedup_rate_7d).toBeCloseTo(66.7, 1); // 2 hits / 3 (hit+miss+hit)
    expect(byId.c4.health_level).toBe('warning');

    // Sort order: critical (most findings first among ties) > warning > healthy
    expect(summaries.map((s) => s.id)).toEqual(['c3', 'c2', 'c4', 'c1']);
  });

  it('returns an empty array when the org has no active clients', async () => {
    mockTables({ clients: [] });
    const summaries = await getClientSummaries('org-empty');
    expect(summaries).toEqual([]);
  });
});
