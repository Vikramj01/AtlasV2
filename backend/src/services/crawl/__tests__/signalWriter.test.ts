/**
 * Unit tests for signalWriter.ts — writeSignalsToLibrary
 *
 * Covers:
 *   1.  Happy path — updates crawl_pages, inserts signals, updates scope
 *   2.  No signals — skips detected_signals insert; still updates page and scope
 *   3.  Page update error — logs warning, does NOT throw (non-fatal)
 *   4.  Signal insert error — logs warning, does NOT throw (non-fatal)
 *   5.  Scope update error — logs warning, does NOT throw (non-fatal)
 *   6.  Health counts — correctly tallies healthy / degraded / missing
 *   7.  misconfigured signals counted as degraded
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks ──────────────────────────────────────────────────────────────

const mockFrom = vi.hoisted(() => vi.fn());

vi.mock('@/services/database/supabase', () => ({
  supabaseAdmin: { from: mockFrom },
}));

vi.mock('@/utils/logger', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { writeSignalsToLibrary } from '../signalWriter';
import type { WriteSignalsArgs } from '@/types/crawl';
import logger from '@/utils/logger';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSignal(health_status: string) {
  return {
    signal_type:     'gtm_container' as const,
    signal_name:     'GTM-TEST',
    signal_id:       'GTM-TEST',
    health_status:   health_status as 'healthy',
    health_score:    health_status === 'healthy' ? 100 : 50,
    detected_at:     null,
    firing_triggers: [],
    parameters:      {},
    issues:          [],
  };
}

function makeArgs(overrides: Partial<WriteSignalsArgs> = {}): WriteSignalsArgs {
  return {
    org_id:          'org-1',
    crawl_run_id:    'run-1',
    crawl_page_id:   'page-1',
    scope_id:        'scope-1',
    signals:         [makeSignal('healthy')],
    http_status:     200,
    scan_duration_ms: 1200,
    ...overrides,
  };
}

/** Creates a mock that chains update().eq() → resolves */
function makeUpdateChain(result: { error: unknown }) {
  const eqMock  = vi.fn().mockResolvedValue(result);
  const updateMock = vi.fn().mockReturnValue({ eq: eqMock });
  return { updateMock, eqMock };
}

/** Creates a mock that chains insert() → resolves */
function makeInsertChain(result: { error: unknown }) {
  const insertMock = vi.fn().mockResolvedValue(result);
  return { insertMock };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('writeSignalsToLibrary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('happy path — calls update on crawl_pages, insert on detected_signals, update on org_page_scope', async () => {
    const pageUpdate  = makeUpdateChain({ error: null });
    const signalInsert = makeInsertChain({ error: null });
    const scopeUpdate  = makeUpdateChain({ error: null });

    let callIndex = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'crawl_pages')       return { update: pageUpdate.updateMock };
      if (table === 'detected_signals')  return { insert: signalInsert.insertMock };
      if (table === 'org_page_scope')    return { update: scopeUpdate.updateMock };
      callIndex++;
      return {};
    });

    await expect(writeSignalsToLibrary(makeArgs())).resolves.toBeUndefined();

    expect(pageUpdate.updateMock).toHaveBeenCalledOnce();
    expect(signalInsert.insertMock).toHaveBeenCalledOnce();
    expect(scopeUpdate.updateMock).toHaveBeenCalledOnce();
  });

  it('skips signal insert when signals array is empty', async () => {
    const pageUpdate  = makeUpdateChain({ error: null });
    const signalInsert = makeInsertChain({ error: null });
    const scopeUpdate  = makeUpdateChain({ error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'crawl_pages')    return { update: pageUpdate.updateMock };
      if (table === 'detected_signals') return { insert: signalInsert.insertMock };
      if (table === 'org_page_scope') return { update: scopeUpdate.updateMock };
      return {};
    });

    await writeSignalsToLibrary(makeArgs({ signals: [] }));
    expect(signalInsert.insertMock).not.toHaveBeenCalled();
    expect(pageUpdate.updateMock).toHaveBeenCalledOnce();
    expect(scopeUpdate.updateMock).toHaveBeenCalledOnce();
  });

  it('does not throw when crawl_pages update fails — logs warning', async () => {
    const pageUpdate  = makeUpdateChain({ error: { message: 'db connection lost' } });
    const signalInsert = makeInsertChain({ error: null });
    const scopeUpdate  = makeUpdateChain({ error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'crawl_pages')       return { update: pageUpdate.updateMock };
      if (table === 'detected_signals')  return { insert: signalInsert.insertMock };
      if (table === 'org_page_scope')    return { update: scopeUpdate.updateMock };
      return {};
    });

    await expect(writeSignalsToLibrary(makeArgs())).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ crawl_page_id: 'page-1' }),
      expect.stringContaining('crawl_pages'),
    );
  });

  it('does not throw when detected_signals insert fails — logs warning', async () => {
    const pageUpdate  = makeUpdateChain({ error: null });
    const signalInsert = makeInsertChain({ error: { message: 'insert error' } });
    const scopeUpdate  = makeUpdateChain({ error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'crawl_pages')       return { update: pageUpdate.updateMock };
      if (table === 'detected_signals')  return { insert: signalInsert.insertMock };
      if (table === 'org_page_scope')    return { update: scopeUpdate.updateMock };
      return {};
    });

    await expect(writeSignalsToLibrary(makeArgs())).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ crawl_page_id: 'page-1' }),
      expect.stringContaining('detected_signals'),
    );
  });

  it('does not throw when org_page_scope update fails — logs warning', async () => {
    const pageUpdate  = makeUpdateChain({ error: null });
    const signalInsert = makeInsertChain({ error: null });
    const scopeUpdate  = makeUpdateChain({ error: { message: 'scope error' } });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'crawl_pages')       return { update: pageUpdate.updateMock };
      if (table === 'detected_signals')  return { insert: signalInsert.insertMock };
      if (table === 'org_page_scope')    return { update: scopeUpdate.updateMock };
      return {};
    });

    await expect(writeSignalsToLibrary(makeArgs())).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ scope_id: 'scope-1' }),
      expect.stringContaining('org_page_scope'),
    );
  });

  it('correctly tallies healthy / degraded / missing counts', async () => {
    const capturedPayload: Record<string, unknown>[] = [];
    const eqMock = vi.fn().mockResolvedValue({ error: null });
    const updateMock = vi.fn().mockImplementation((payload: Record<string, unknown>) => {
      capturedPayload.push(payload);
      return { eq: eqMock };
    });
    const signalInsert = makeInsertChain({ error: null });
    const scopeUpdate  = makeUpdateChain({ error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'crawl_pages')       return { update: updateMock };
      if (table === 'detected_signals')  return { insert: signalInsert.insertMock };
      if (table === 'org_page_scope')    return { update: scopeUpdate.updateMock };
      return {};
    });

    const signals = [
      makeSignal('healthy'),
      makeSignal('healthy'),
      makeSignal('degraded'),
      makeSignal('missing'),
    ];

    await writeSignalsToLibrary(makeArgs({ signals }));

    expect(capturedPayload[0]).toMatchObject({
      signals_found:    4,
      signals_healthy:  2,
      signals_degraded: 1,
      signals_missing:  1,
    });
  });

  it('counts misconfigured signals as degraded', async () => {
    const capturedPayload: Record<string, unknown>[] = [];
    const eqMock = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'crawl_pages') {
        return {
          update: vi.fn().mockImplementation((p: Record<string, unknown>) => {
            capturedPayload.push(p);
            return { eq: eqMock };
          }),
        };
      }
      if (table === 'detected_signals') return { insert: vi.fn().mockResolvedValue({ error: null }) };
      if (table === 'org_page_scope')   return { update: vi.fn().mockReturnValue({ eq: eqMock }) };
      return {};
    });

    const signals = [makeSignal('misconfigured'), makeSignal('misconfigured')];
    await writeSignalsToLibrary(makeArgs({ signals }));

    expect(capturedPayload[0]).toMatchObject({
      signals_degraded: 2,
      signals_healthy:  0,
    });
  });
});
