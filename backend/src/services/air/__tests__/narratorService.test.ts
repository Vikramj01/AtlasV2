import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/database/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock('@/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/services/air/ingestion/ingestionOrchestrator', () => ({
  getAirEligibleOrgIds: vi.fn(),
}));

vi.mock('@/services/usage/claudeClient', () => ({
  callClaude: vi.fn(),
}));

import { supabaseAdmin } from '@/services/database/supabase';
import { getAirEligibleOrgIds } from '@/services/air/ingestion/ingestionOrchestrator';
import { callClaude } from '@/services/usage/claudeClient';
import {
  buildSystemPrompt,
  buildUserMessage,
  extractNarrative,
  narrateAnomaly,
  runNarrationForOrg,
  runNarrationForAllActiveOrgs,
  type AnomalyInput,
  type CorrelationInput,
} from '../narratorService';

// ── helpers ────────────────────────────────────────────────────────────────────

function makeChain(data: unknown = null, error: unknown = null) {
  const chain: Record<string, unknown> = {};
  const terminal = { data, error };
  const resolved = Promise.resolve(terminal);
  for (const m of ['select', 'eq', 'gte', 'lte', 'in', 'delete', 'insert']) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.single      = vi.fn().mockResolvedValue(terminal);
  chain.maybeSingle = vi.fn().mockResolvedValue(terminal);
  chain.then = (resolve: Function) => resolved.then(resolve);
  return chain as any;
}

function makeAnthropicResponse(text: string, model = 'claude-sonnet-4-6') {
  return {
    model,
    content: [{ type: 'text', text }],
    usage:   { input_tokens: 100, output_tokens: 50 },
  };
}

function makeAnomaly(overrides: Partial<AnomalyInput> = {}): AnomalyInput {
  return {
    id:             'anom-1',
    source:         'google_ads',
    metric_name:    'spend',
    dimension:      null,
    detected_date:  '2026-07-10',
    baseline_value: 1000,
    observed_value: 400,
    deviation_pct:  -60,
    severity:       'high',
    ...overrides,
  };
}

// ── buildSystemPrompt ─────────────────────────────────────────────────────────

describe('buildSystemPrompt', () => {
  it('returns a non-empty string', () => {
    expect(buildSystemPrompt().length).toBeGreaterThan(50);
  });

  it('instructs 2–3 sentences', () => {
    expect(buildSystemPrompt()).toContain('2–3 sentences');
  });
});

// ── buildUserMessage ──────────────────────────────────────────────────────────

describe('buildUserMessage', () => {
  const anomaly = makeAnomaly();

  it('includes metric name and source', () => {
    const msg = buildUserMessage(anomaly, []);
    expect(msg).toContain('spend');
    expect(msg).toContain('google ads');
  });

  it('shows direction "dropped" for negative deviation', () => {
    expect(buildUserMessage(anomaly, [])).toContain('dropped');
  });

  it('shows direction "increased" for positive deviation', () => {
    expect(buildUserMessage(makeAnomaly({ deviation_pct: 35 }), [])).toContain('increased');
  });

  it('includes dimension when present', () => {
    const msg = buildUserMessage(makeAnomaly({ dimension: 'campaign-A' }), []);
    expect(msg).toContain('campaign-A');
  });

  it('includes top correlated factor when present', () => {
    const factors: CorrelationInput[] = [
      { factor_type: 'dqm_alert', factor_date: '2026-07-09', proximity_days: 1, confidence_score: 0.75 },
    ];
    const msg = buildUserMessage(anomaly, factors);
    expect(msg).toContain('tracking tag failure');
  });

  it('picks highest-confidence factor when multiple present', () => {
    const factors: CorrelationInput[] = [
      { factor_type: 'cse_signal_change',   factor_date: '2026-07-09', proximity_days: 1, confidence_score: 0.5  },
      { factor_type: 'andromeda_score_drop', factor_date: '2026-07-10', proximity_days: 0, confidence_score: 1.0  },
    ];
    const msg = buildUserMessage(anomaly, factors);
    expect(msg).toContain('health score dropped');
  });

  it('omits correlated factor section when no factors given', () => {
    expect(buildUserMessage(anomaly, [])).not.toContain('correlated');
  });
});

// ── extractNarrative ──────────────────────────────────────────────────────────

describe('extractNarrative', () => {
  it('extracts text from first text block', () => {
    const response = { content: [{ type: 'text', text: 'Spend fell sharply.' }] };
    expect(extractNarrative(response)).toBe('Spend fell sharply.');
  });

  it('trims whitespace', () => {
    const response = { content: [{ type: 'text', text: '  Spend fell.  ' }] };
    expect(extractNarrative(response)).toBe('Spend fell.');
  });

  it('returns empty string when no text block found', () => {
    const response = { content: [{ type: 'tool_use' }] };
    expect(extractNarrative(response)).toBe('');
  });
});

// ── narrateAnomaly ────────────────────────────────────────────────────────────

describe('narrateAnomaly', () => {
  beforeEach(() => vi.resetAllMocks());

  it('calls callClaude with correct event type', async () => {
    vi.mocked(callClaude).mockResolvedValue(makeAnthropicResponse('Spend dropped.') as any);
    await narrateAnomaly('org-1', makeAnomaly(), []);
    expect(vi.mocked(callClaude)).toHaveBeenCalledOnce();
    const opts = vi.mocked(callClaude).mock.calls[0][0];
    expect(opts.event_type).toBe('ai_insight_generated');
    expect(opts.org_id).toBe('org-1');
  });

  it('returns an InsightRow with narrative and model_version', async () => {
    vi.mocked(callClaude).mockResolvedValue(makeAnthropicResponse('Spend dropped 60%.', 'claude-sonnet-4-6') as any);
    const row = await narrateAnomaly('org-1', makeAnomaly(), []);
    expect(row.narrative).toBe('Spend dropped 60%.');
    expect(row.model_version).toBe('claude-sonnet-4-6');
    expect(row.anomaly_id).toBe('anom-1');
    expect(row.org_id).toBe('org-1');
  });

  it('stores input_payload with anomaly and factors', async () => {
    vi.mocked(callClaude).mockResolvedValue(makeAnthropicResponse('Narrative.') as any);
    const factors: CorrelationInput[] = [{ factor_type: 'dqm_alert', factor_date: '2026-07-09', proximity_days: 1, confidence_score: 0.75 }];
    const row = await narrateAnomaly('org-1', makeAnomaly(), factors);
    expect((row.input_payload as any).factors).toHaveLength(1);
    expect((row.input_payload as any).anomaly.id).toBe('anom-1');
  });

  it('propagates callClaude errors', async () => {
    vi.mocked(callClaude).mockRejectedValue(new Error('API error'));
    await expect(narrateAnomaly('org-1', makeAnomaly(), [])).rejects.toThrow('API error');
  });
});

// ── runNarrationForOrg ────────────────────────────────────────────────────────

describe('runNarrationForOrg', () => {
  beforeEach(() => vi.resetAllMocks());

  const date  = '2026-07-10';
  const orgId = 'org-1';

  it('skips when no anomalies found', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(makeChain([], null));
    await expect(runNarrationForOrg(orgId, date)).resolves.toBeUndefined();
    expect(vi.mocked(supabaseAdmin.from)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(callClaude)).not.toHaveBeenCalled();
  });

  it('throws when anomaly fetch returns an error', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(makeChain(null, { message: 'DB down' }));
    await expect(runNarrationForOrg(orgId, date)).rejects.toThrow('DB down');
  });

  it('inserts insight rows after successful narration', async () => {
    const anomalies  = [makeAnomaly()];
    const deleteChain = makeChain(null, null);
    const insertChain = makeChain(null, null);

    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain(anomalies, null))  // air_anomalies
      .mockReturnValueOnce(makeChain([], null))          // air_insight_correlations
      .mockReturnValueOnce(deleteChain)                  // delete stale insights
      .mockReturnValueOnce(insertChain);                 // insert new insights

    vi.mocked(callClaude).mockResolvedValue(makeAnthropicResponse('Spend fell 60% yesterday.') as any);

    await runNarrationForOrg(orgId, date);

    expect(insertChain.insert).toHaveBeenCalledOnce();
    const [rows] = insertChain.insert.mock.calls[0] as [{ narrative: string; org_id: string }[]];
    expect(rows).toHaveLength(1);
    expect(rows[0].narrative).toBe('Spend fell 60% yesterday.');
    expect(rows[0].org_id).toBe(orgId);
  });

  it('deletes stale insights for successfully narrated anomalies', async () => {
    const anomalies  = [makeAnomaly({ id: 'anom-x' })];
    const deleteChain = makeChain(null, null);
    const insertChain = makeChain(null, null);

    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain(anomalies, null))
      .mockReturnValueOnce(makeChain([], null))
      .mockReturnValueOnce(deleteChain)
      .mockReturnValueOnce(insertChain);

    vi.mocked(callClaude).mockResolvedValue(makeAnthropicResponse('Narrative.') as any);

    await runNarrationForOrg(orgId, date);

    expect(deleteChain.delete).toHaveBeenCalledOnce();
    expect(deleteChain.in).toHaveBeenCalledWith('anomaly_id', ['anom-x']);
  });

  it('isolates per-anomaly failures and still inserts successful ones', async () => {
    const anomalies = [makeAnomaly({ id: 'anom-good' }), makeAnomaly({ id: 'anom-bad' })];
    const deleteChain = makeChain(null, null);
    const insertChain = makeChain(null, null);

    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain(anomalies, null))
      .mockReturnValueOnce(makeChain([], null))
      .mockReturnValueOnce(deleteChain)
      .mockReturnValueOnce(insertChain);

    vi.mocked(callClaude)
      .mockResolvedValueOnce(makeAnthropicResponse('Good narrative.') as any)
      .mockRejectedValueOnce(new Error('Claude timeout'));

    await runNarrationForOrg(orgId, date);

    const [rows] = insertChain.insert.mock.calls[0] as [{ anomaly_id: string }[]];
    expect(rows).toHaveLength(1);
    expect(rows[0].anomaly_id).toBe('anom-good');
  });

  it('groups correlations by anomaly_id and passes them to narrateAnomaly', async () => {
    const anomalies = [makeAnomaly({ id: 'anom-1' })];
    const correlations = [
      { anomaly_id: 'anom-1', factor_type: 'dqm_alert', factor_date: '2026-07-09', proximity_days: 1, confidence_score: 0.75 },
    ];

    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain(anomalies, null))
      .mockReturnValueOnce(makeChain(correlations, null))
      .mockReturnValueOnce(makeChain(null, null))  // delete
      .mockReturnValueOnce(makeChain(null, null)); // insert

    vi.mocked(callClaude).mockResolvedValue(makeAnthropicResponse('Narrative.') as any);

    await runNarrationForOrg(orgId, date);

    const callArgs = vi.mocked(callClaude).mock.calls[0][0];
    expect(callArgs.messages[0].content).toContain('tracking tag failure');
  });

  it('throws when final insert returns an error', async () => {
    const anomalies = [makeAnomaly()];

    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain(anomalies, null))
      .mockReturnValueOnce(makeChain([], null))
      .mockReturnValueOnce(makeChain(null, null))                        // delete ok
      .mockReturnValueOnce(makeChain(null, { message: 'insert fail' })); // insert error

    vi.mocked(callClaude).mockResolvedValue(makeAnthropicResponse('Narrative.') as any);

    await expect(runNarrationForOrg(orgId, date)).rejects.toThrow('insert fail');
  });
});

// ── runNarrationForAllActiveOrgs ──────────────────────────────────────────────

describe('runNarrationForAllActiveOrgs', () => {
  beforeEach(() => vi.resetAllMocks());

  it('runs narration for each eligible org', async () => {
    vi.mocked(getAirEligibleOrgIds).mockResolvedValue(['org-a', 'org-b']);
    vi.mocked(supabaseAdmin.from).mockReturnValue(makeChain([], null));

    await runNarrationForAllActiveOrgs('2026-07-10');
    // Each org: 1 call (anomalies fetch returns empty → no further calls)
    expect(vi.mocked(supabaseAdmin.from)).toHaveBeenCalledTimes(2);
  });

  it('continues to next org when one fails', async () => {
    vi.mocked(getAirEligibleOrgIds).mockResolvedValue(['org-bad', 'org-ok']);
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain(null, { message: 'exploded' }))
      .mockReturnValueOnce(makeChain([], null));

    await expect(
      runNarrationForAllActiveOrgs('2026-07-10'),
    ).resolves.toBeUndefined();
    expect(vi.mocked(supabaseAdmin.from)).toHaveBeenCalledTimes(2);
  });
});
