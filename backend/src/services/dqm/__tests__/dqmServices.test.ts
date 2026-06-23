/**
 * DQM service unit tests
 *
 * Covers:
 *  - gtgProbe: degraded classification, pass, fail, timeout
 *  - dmaPolling: skipped-backoff sentinel, backoff set on failure,
 *    backoff cleared on success, consecutive_failures tracking
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Supabase mock ─────────────────────────────────────────────────────────────

vi.mock('@/services/database/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock('@/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { supabaseAdmin } from '@/services/database/supabase';

// ── Query chain builder ───────────────────────────────────────────────────────

function makeChain(resolvedData: unknown = null, resolvedError: unknown = null) {
  const chain: Record<string, unknown> = {};
  const terminal = { data: resolvedData, error: resolvedError };
  const resolved = Promise.resolve(terminal);

  for (const m of ['select','eq','gte','order','limit','upsert','insert']) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.single      = vi.fn().mockResolvedValue(terminal);
  chain.maybeSingle = vi.fn().mockResolvedValue(terminal);
  // Make the chain itself thenable so await supabase.from(...).upsert(...) works
  chain.then = (resolve: Function) => resolved.then(resolve);

  return chain as any;
}

// ── gtgProbe ──────────────────────────────────────────────────────────────────

describe('probeGTGPath', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  function mockGTMConnection(containerId = 'GTM-TEST') {
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(
      makeChain([{ container_id: containerId }]) as any,
    );
  }

  it('2xx within threshold → pass', async () => {
    mockGTMConnection();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 }) as any;

    const { probeGTGPath } = await import('../gtgProbe');
    const result = await probeGTGPath('org-1', 2000);

    expect(result.checkStatus).toBe('pass');
    expect(result.httpStatus).toBe(200);
  });

  it('2xx but latency above threshold → degraded', async () => {
    mockGTMConnection();

    // Simulate slow response by advancing Date.now during the fetch
    let callCount = 0;
    const realDateNow = Date.now;
    vi.spyOn(Date, 'now').mockImplementation(() => {
      callCount++;
      return callCount === 1 ? 1000 : 1000 + 2500; // 2500ms elapsed
    });

    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 }) as any;

    const { probeGTGPath } = await import('../gtgProbe');
    const result = await probeGTGPath('org-1', 2000);

    expect(result.checkStatus).toBe('degraded');
    expect(result.responseMs).toBeGreaterThan(2000);

    vi.spyOn(Date, 'now').mockRestore();
    Date.now = realDateNow;
  });

  it('non-2xx response → fail', async () => {
    mockGTMConnection();
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 }) as any;

    const { probeGTGPath } = await import('../gtgProbe');
    const result = await probeGTGPath('org-1', 2000);

    expect(result.checkStatus).toBe('fail');
    expect(result.httpStatus).toBe(503);
  });

  it('fetch aborted → timeout', async () => {
    mockGTMConnection();
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    global.fetch = vi.fn().mockRejectedValue(abortErr) as any;

    const { probeGTGPath } = await import('../gtgProbe');
    const result = await probeGTGPath('org-1', 2000);

    expect(result.checkStatus).toBe('timeout');
  });

  it('no GTM connection → error with message', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(makeChain([]) as any);

    const { probeGTGPath } = await import('../gtgProbe');
    const result = await probeGTGPath('org-1', 2000);

    expect(result.checkStatus).toBe('error');
    expect(result.errorMessage).toMatch(/No GTM connection/);
  });
});

// ── dmaPolling ────────────────────────────────────────────────────────────────

describe('dmaPolling', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  describe('pollDMADiagnostics', () => {
    it('returns skipped-backoff when backoff_until is in the future', async () => {
      const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();

      vi.mocked(supabaseAdmin.from).mockReturnValue(
        makeChain({ backoff_until: future, consecutive_failures: 2 }) as any,
      );

      const { pollDMADiagnostics } = await import('../dmaPolling');
      const result = await pollDMADiagnostics('org-1');

      expect(result).toBe('skipped-backoff');
    });

    it('proceeds with poll when backoff_until is in the past', async () => {
      const past = new Date(Date.now() - 60_000).toISOString();

      vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
        if (table === 'dqm_dma_poll_state') {
          return makeChain({ backoff_until: past, consecutive_failures: 1 }) as any;
        }
        // enricher_runs
        return makeChain([
          { status: 'completed', matched_count: 80, record_count: 100, dma_response: null, destinations: [{ type: 'google' }] },
        ]) as any;
      });

      const { pollDMADiagnostics } = await import('../dmaPolling');
      const result = await pollDMADiagnostics('org-1');

      expect(result).not.toBe('skipped-backoff');
      expect(typeof result).toBe('object');
      if (typeof result === 'object') {
        expect(result.uploadSuccessRate).toBe(100);
      }
    });

    it('proceeds with poll when no poll state row exists', async () => {
      vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
        if (table === 'dqm_dma_poll_state') {
          return makeChain(null) as any;
        }
        return makeChain([]) as any;
      });

      const { pollDMADiagnostics } = await import('../dmaPolling');
      const result = await pollDMADiagnostics('org-1');

      expect(result).not.toBe('skipped-backoff');
    });
  });

  describe('updateDMABackoff', () => {
    it('on failure: increments consecutive_failures and sets backoff_until', async () => {
      const chain = makeChain();
      vi.mocked(supabaseAdmin.from).mockReturnValue(chain as any);

      const { updateDMABackoff } = await import('../dmaPolling');
      await updateDMABackoff('org-1', true, 0);

      expect(supabaseAdmin.from).toHaveBeenCalledWith('dqm_dma_poll_state');
      const upsertCall = vi.mocked(chain.upsert).mock.calls[0][0] as Record<string, unknown>;
      expect(upsertCall.consecutive_failures).toBe(1);
      expect(upsertCall.backoff_until).toBeDefined();
      // First failure: 5 min backoff
      const backoffUntil = new Date(upsertCall.backoff_until as string).getTime();
      expect(backoffUntil).toBeGreaterThan(Date.now() + 4 * 60 * 1000);
      expect(backoffUntil).toBeLessThan(Date.now() + 6 * 60 * 1000);
    });

    it('on success: clears backoff_until and resets consecutive_failures to 0', async () => {
      const chain = makeChain();
      vi.mocked(supabaseAdmin.from).mockReturnValue(chain as any);

      const { updateDMABackoff } = await import('../dmaPolling');
      await updateDMABackoff('org-1', false, 3);

      const upsertCall = vi.mocked(chain.upsert).mock.calls[0][0] as Record<string, unknown>;
      expect(upsertCall.backoff_until).toBeNull();
      expect(upsertCall.consecutive_failures).toBe(0);
    });

    it('backoff doubles each consecutive failure and is capped at 4 hours', async () => {
      const chain = makeChain();
      vi.mocked(supabaseAdmin.from).mockReturnValue(chain as any);

      const { updateDMABackoff } = await import('../dmaPolling');

      // 5th failure: 5min * 2^4 = 80 min → but capped at 4h (240 min)
      // Actually 5min * 2^4 = 80min which is below the cap
      await updateDMABackoff('org-1', true, 4);
      const call = vi.mocked(chain.upsert).mock.calls[0][0] as Record<string, unknown>;
      expect(call.consecutive_failures).toBe(5);
      const delayMs = new Date(call.backoff_until as string).getTime() - Date.now();
      // 5 * 2^4 = 80 min = 4800s
      expect(delayMs).toBeGreaterThan(79 * 60 * 1000);
      expect(delayMs).toBeLessThan(81 * 60 * 1000);

      // Many failures: cap at 4h
      vi.mocked(chain.upsert).mockClear();
      await updateDMABackoff('org-1', true, 20);
      const cappedCall = vi.mocked(chain.upsert).mock.calls[0][0] as Record<string, unknown>;
      const cappedDelay = new Date(cappedCall.backoff_until as string).getTime() - Date.now();
      expect(cappedDelay).toBeLessThanOrEqual(4 * 60 * 60 * 1000 + 1000);
    });
  });
});
