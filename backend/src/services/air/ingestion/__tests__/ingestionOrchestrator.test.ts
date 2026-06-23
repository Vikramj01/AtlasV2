import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/database/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock('@/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/services/air/ingestion/googleAdsConnector', () => ({
  ingestGoogleAds: vi.fn(),
}));

import { supabaseAdmin } from '@/services/database/supabase';
import { ingestGoogleAds } from '@/services/air/ingestion/googleAdsConnector';
import { getAirEligibleOrgIds, runIngestionForOrg, runIngestionForAllActiveOrgs } from '../ingestionOrchestrator';

function makeChain(data: unknown = null, error: unknown = null) {
  const chain: Record<string, unknown> = {};
  const terminal = { data, error };
  const resolved = Promise.resolve(terminal);
  for (const m of ['select', 'eq', 'in']) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.single      = vi.fn().mockResolvedValue(terminal);
  chain.maybeSingle = vi.fn().mockResolvedValue(terminal);
  chain.then = (resolve: Function) => resolved.then(resolve);
  return chain as any;
}

// ── getAirEligibleOrgIds ──────────────────────────────────────────────────────

describe('getAirEligibleOrgIds', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns org_ids on pro/agency plan with active connections', async () => {
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain([{ organization_id: 'org-a' }, { organization_id: 'org-b' }], null))
      .mockReturnValueOnce(makeChain([{ organization_id: 'org-a' }], null));

    const ids = await getAirEligibleOrgIds();
    expect(ids).toEqual(['org-a']); // org-b has sub but no connection
  });

  it('returns empty array when no subscriptions found', async () => {
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain([], null))
      .mockReturnValueOnce(makeChain([], null));

    const ids = await getAirEligibleOrgIds();
    expect(ids).toHaveLength(0);
  });

  it('returns empty array on subscription query error', async () => {
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain(null, { message: 'db error' }))
      .mockReturnValueOnce(makeChain([], null));

    const ids = await getAirEligibleOrgIds();
    expect(ids).toHaveLength(0);
  });

  it('excludes orgs with sub but no active platform connection', async () => {
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain([{ organization_id: 'org-sub-only' }], null))
      .mockReturnValueOnce(makeChain([], null)); // no connections

    const ids = await getAirEligibleOrgIds();
    expect(ids).toHaveLength(0);
  });
});

// ── runIngestionForOrg ────────────────────────────────────────────────────────

describe('runIngestionForOrg', () => {
  beforeEach(() => vi.resetAllMocks());

  it('calls ingestGoogleAds with orgId and date', async () => {
    vi.mocked(ingestGoogleAds).mockResolvedValue(undefined);
    await runIngestionForOrg('org-1', '2026-07-10');
    expect(ingestGoogleAds).toHaveBeenCalledWith('org-1', '2026-07-10');
  });

  it('does not throw when ingestGoogleAds rejects', async () => {
    vi.mocked(ingestGoogleAds).mockRejectedValue(new Error('API down'));
    await expect(runIngestionForOrg('org-1', '2026-07-10')).resolves.toBeUndefined();
  });
});

// ── runIngestionForAllActiveOrgs ──────────────────────────────────────────────

describe('runIngestionForAllActiveOrgs', () => {
  beforeEach(() => vi.resetAllMocks());

  it('runs ingestion for each eligible org', async () => {
    vi.mocked(ingestGoogleAds).mockResolvedValue(undefined);
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain([{ organization_id: 'org-a' }, { organization_id: 'org-b' }], null))
      .mockReturnValueOnce(makeChain([{ organization_id: 'org-a' }, { organization_id: 'org-b' }], null));

    await runIngestionForAllActiveOrgs();
    expect(ingestGoogleAds).toHaveBeenCalledTimes(2);
  });

  it('continues processing remaining orgs when one fails', async () => {
    vi.mocked(ingestGoogleAds)
      .mockRejectedValueOnce(new Error('org-bad exploded'))
      .mockResolvedValueOnce(undefined);
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain([{ organization_id: 'org-bad' }, { organization_id: 'org-good' }], null))
      .mockReturnValueOnce(makeChain([{ organization_id: 'org-bad' }, { organization_id: 'org-good' }], null));

    await expect(runIngestionForAllActiveOrgs()).resolves.toBeUndefined();
    expect(ingestGoogleAds).toHaveBeenCalledTimes(2);
  });
});
