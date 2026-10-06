/**
 * GA4 Admin / L11 / Junk Gate PRD §A.5: the GA4 sync branch records a
 * client-scoped discontinuity only for a CHANGED snapshot that has a previous
 * one and a client association, and a failure there never fails the sync.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const snap = (currency: string) => ({
  property_id: '123', currency_code: currency, time_zone: 'UTC', web_streams: [], ads_links: null, data_retention: null,
});

vi.mock('@/services/database/supabase', () => ({ supabaseAdmin: {} }));
vi.mock('../googleAdsSync', () => ({ syncConversionActions: vi.fn(), syncCampaignGoals: vi.fn(), syncCustomerSettings: vi.fn() }));
vi.mock('../metaSync', () => ({ syncCustomConversions: vi.fn(), syncAemPriorities: vi.fn(), syncMetaCampaigns: vi.fn() }));
vi.mock('../ga4Sync', () => ({ syncKeyEvents: vi.fn() }));
vi.mock('../googleAdsStatsSync', () => ({ syncConversionStats: vi.fn() }));
vi.mock('../metaStatsSync', () => ({ syncAdAccountStats: vi.fn() }));
vi.mock('../ga4StatsSync', () => ({ syncKeyEventStats: vi.fn() }));
vi.mock('@/services/database/connectionQueries', () => ({ updateLastSynced: vi.fn() }));
vi.mock('@/services/database/discontinuityQueries', () => ({ writeClientDiscontinuities: vi.fn() }));
vi.mock('../ga4ConfigSync', () => ({ syncGa4Config: vi.fn() }));
vi.mock('@/utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { runConfigSyncForConnection } from '../syncOrchestrator';
import { syncGa4Config } from '../ga4ConfigSync';
import { writeClientDiscontinuities } from '@/services/database/discontinuityQueries';
import { updateLastSynced } from '@/services/database/connectionQueries';

const job = { connectionId: 'c1', orgId: 'org-1', platform: 'ga4' as const };

beforeEach(() => {
  vi.mocked(syncGa4Config).mockReset();
  vi.mocked(writeClientDiscontinuities).mockReset();
  vi.mocked(updateLastSynced).mockReset();
});

describe('GA4 sync branch → discontinuities', () => {
  it('writes a currency-change discontinuity for a changed snapshot with a previous one and a client', async () => {
    vi.mocked(syncGa4Config).mockResolvedValue({ changed: true, client_id: 'client-1', snapshot: snap('USD'), previous: snap('GBP'), hash: 'h', carried_forward: [] });
    await runConfigSyncForConnection(job);
    expect(writeClientDiscontinuities).toHaveBeenCalledTimes(1);
    const rows = vi.mocked(writeClientDiscontinuities).mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ platform: 'ga4', kind: 'client_tracking_change', client_id: 'client-1', organization_id: 'org-1', title: 'GA4 property currency changed' });
  });

  it('writes no qualifying row for a non-qualifying change (time zone)', async () => {
    const next = snap('GBP'); next.time_zone = 'Europe/London';
    vi.mocked(syncGa4Config).mockResolvedValue({ changed: true, client_id: 'client-1', snapshot: next, previous: snap('GBP'), hash: 'h', carried_forward: [] });
    await runConfigSyncForConnection(job);
    expect(vi.mocked(writeClientDiscontinuities).mock.calls[0]?.[0] ?? []).toEqual([]);
  });

  it('writes nothing for a first snapshot (no previous), an unchanged snapshot, or a connection with no client', async () => {
    vi.mocked(syncGa4Config).mockResolvedValue({ changed: true, client_id: 'client-1', snapshot: snap('USD'), previous: null, hash: 'h', carried_forward: [] });
    await runConfigSyncForConnection(job);
    vi.mocked(syncGa4Config).mockResolvedValue({ changed: false, client_id: 'client-1', snapshot: snap('USD'), previous: snap('GBP'), hash: 'h', carried_forward: [] });
    await runConfigSyncForConnection(job);
    vi.mocked(syncGa4Config).mockResolvedValue({ changed: true, client_id: null, snapshot: snap('USD'), previous: snap('GBP'), hash: 'h', carried_forward: [] });
    await runConfigSyncForConnection(job);
    expect(writeClientDiscontinuities).not.toHaveBeenCalled();
  });

  it('a failure writing the discontinuity never fails the sync', async () => {
    vi.mocked(syncGa4Config).mockResolvedValue({ changed: true, client_id: 'client-1', snapshot: snap('USD'), previous: snap('GBP'), hash: 'h', carried_forward: [] });
    vi.mocked(writeClientDiscontinuities).mockRejectedValue(new Error('db down'));
    await expect(runConfigSyncForConnection(job)).resolves.toBeUndefined();
    expect(updateLastSynced).toHaveBeenCalledWith('c1');
  });
});
