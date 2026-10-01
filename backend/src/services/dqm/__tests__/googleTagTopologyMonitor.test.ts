import { describe, it, expect, vi, beforeEach } from 'vitest';

// A table-keyed supabase mock: each table resolves to the rows registered for it,
// and every insert is recorded.
const tables: Record<string, unknown[]> = {};
const inserts: Array<{ table: string; row: any }> = [];

vi.mock('@/services/database/supabase', () => {
  const makeChain = (table: string) => {
    const chain: any = {};
    for (const m of ['select', 'eq', 'in', 'not', 'order', 'limit']) chain[m] = () => chain;
    chain.insert = (row: any) => { inserts.push({ table, row }); return Promise.resolve({ error: null }); };
    chain.maybeSingle = async () => ({ data: (tables[table] ?? [])[0] ?? null, error: null });
    chain.then = (resolve: Function) => resolve({ data: tables[table] ?? [], error: null });
    return chain;
  };
  return { supabaseAdmin: { from: (table: string) => makeChain(table) } };
});
vi.mock('@/services/gtm/containerParser', () => ({ parseContainerJson: (json: any) => json }));
vi.mock('@/services/database/googleTagTopologyQueries', () => ({ getCurrentTopologyRows: vi.fn().mockResolvedValue([]) }));
vi.mock('@/utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { getCurrentTopologyRows } from '@/services/database/googleTagTopologyQueries';
import { detectTopologyRegression, computeGoogleTagTopologySignals, TOPOLOGY_CHECK_MIN_INTERVAL_MS } from '../googleTagTopologyMonitor';
import type { GTMContainerSnapshot, GTMTag } from '@/types/audit';

const allPages = { triggerId: '1', name: 'All Pages', type: 'PAGEVIEW' };
const googtag = (id: string): GTMTag => ({ tagId: id, name: id, type: 'googtag', firingTriggerId: ['1'], parameter: [{ type: 'TEMPLATE', key: 'tagId', value: id }] });
const conv: GTMTag = { tagId: 'c', name: 'conv', type: 'awct', firingTriggerId: ['1'], parameter: [] };
const container = (tags: GTMTag[]): GTMContainerSnapshot => ({
  container_id: 'c', fetched_at: '', source: 'gtm_api', tags, triggers: [allPages], variables: [], built_in_variables: [], consent_default_tag: null,
});
const healthy = container([googtag('G-1'), googtag('AW-1'), conv]);
const noAdsTag = container([googtag('G-1'), conv]);

const VERIFIED_AT = new Date('2026-10-01T10:00:00Z');
const AFTER = '2026-10-02T00:00:00Z';
const BEFORE = '2026-09-30T00:00:00Z';
const row = (ids: string[], at: string) => ({
  google_tag_id: ids[0], primary_destination_id: ids[0], destination_ids: ids, source: 'operator_declared' as const, declaration_source: 'CLIENT_CONFIRMED' as const, observed_at: at,
});

describe('detectTopologyRegression', () => {
  it('healthy: split observation after verification and the Ads tag present', () => {
    expect(detectTopologyRegression({ verifiedAt: VERIFIED_AT, rows: [row(['G-1'], AFTER), row(['AW-1'], AFTER)], latestContainer: healthy, previousContainer: healthy }))
      .toEqual({ recombined: false, adsTagLost: false });
  });

  it('re-combination: a post-verification observation shows the destinations on one tag', () => {
    expect(detectTopologyRegression({ verifiedAt: VERIFIED_AT, rows: [row(['G-1', 'AW-1'], AFTER)], latestContainer: healthy, previousContainer: healthy }).recombined).toBe(true);
  });

  it('an observation from BEFORE verification is never evidence of re-combination', () => {
    expect(detectTopologyRegression({ verifiedAt: VERIFIED_AT, rows: [row(['G-1', 'AW-1'], BEFORE)], latestContainer: healthy, previousContainer: healthy }).recombined).toBe(false);
  });

  it('Ads tag disappeared: previous container had it, latest does not', () => {
    expect(detectTopologyRegression({ verifiedAt: VERIFIED_AT, rows: [], latestContainer: noAdsTag, previousContainer: healthy }).adsTagLost).toBe(true);
  });

  it('Ads tag missing while the container still uses Ads is lost even with no previous snapshot', () => {
    expect(detectTopologyRegression({ verifiedAt: VERIFIED_AT, rows: [], latestContainer: noAdsTag, previousContainer: null }).adsTagLost).toBe(true);
  });

  it('a container with no Ads destination at all (and no earlier Ads tag) is not "lost"', () => {
    expect(detectTopologyRegression({ verifiedAt: VERIFIED_AT, rows: [], latestContainer: container([googtag('G-1')]), previousContainer: container([googtag('G-1')]) }).adsTagLost).toBe(false);
  });
});

describe('computeGoogleTagTopologySignals', () => {
  const now = new Date('2026-10-05T12:00:00Z');
  const plan = { client_id: 'c1', connection_id: 'conn-1', verified_at: VERIFIED_AT.toISOString() };

  beforeEach(() => {
    for (const k of Object.keys(tables)) delete tables[k];
    inserts.length = 0;
    vi.mocked(getCurrentTopologyRows).mockResolvedValue([]);
  });

  function arrange(over: { stored?: unknown[]; conn?: unknown; snaps?: unknown[] } = {}) {
    tables['google_tag_split_plans'] = [plan];
    tables['dqm_google_tag_topology_checks'] = over.stored ?? [];
    tables['gtm_container_connections'] = [over.conn ?? { id: 'conn-1', auth_method: 'oauth' }];
    tables['gtm_container_snapshots'] = over.snaps ?? [{ container_json: healthy }, { container_json: healthy }];
  }

  it('null when no client has a verified split', async () => {
    tables['google_tag_split_plans'] = [];
    expect(await computeGoogleTagTopologySignals('org-1', false, now)).toBeNull();
  });

  it('runs and persists a check for a client with no prior check, healthy → pass', async () => {
    arrange();
    const out = await computeGoogleTagTopologySignals('org-1', false, now);
    expect(out).toEqual({ monitoredCount: 1, recombinedCount: 0, adsTagLostCount: 0, existingAlertActive: false });
    expect(inserts).toHaveLength(1);
    expect(inserts[0].row).toMatchObject({ org_id: 'org-1', client_id: 'c1', recombined: false, ads_tag_lost: false, check_status: 'pass' });
  });

  it('24h gate: a check younger than 24h is reused (no new insert) and its stored flags still count', async () => {
    arrange({ stored: [{ client_id: 'c1', recombined: false, ads_tag_lost: true, checked_at: new Date(now.getTime() - 60 * 60 * 1000).toISOString() }] });
    const out = await computeGoogleTagTopologySignals('org-1', true, now);
    expect(inserts).toHaveLength(0);
    expect(out).toMatchObject({ monitoredCount: 1, adsTagLostCount: 1, existingAlertActive: true });
  });

  it('a check older than 24h is recomputed and persisted', async () => {
    arrange({ stored: [{ client_id: 'c1', recombined: true, ads_tag_lost: false, checked_at: new Date(now.getTime() - TOPOLOGY_CHECK_MIN_INTERVAL_MS - 1000).toISOString() }] });
    const out = await computeGoogleTagTopologySignals('org-1', false, now);
    expect(inserts).toHaveLength(1);
    expect(out).toMatchObject({ recombinedCount: 0 }); // the fresh check supersedes the stale "recombined"
  });

  it('records a lost Ads tag as fail and a re-combination as degraded', async () => {
    arrange({ snaps: [{ container_json: noAdsTag }, { container_json: healthy }] });
    await computeGoogleTagTopologySignals('org-1', false, now);
    expect(inserts[0].row).toMatchObject({ ads_tag_lost: true, check_status: 'fail' });

    inserts.length = 0;
    arrange();
    vi.mocked(getCurrentTopologyRows).mockResolvedValue([{ ...row(['G-1', 'AW-1'], AFTER), id: 'r', evidence_class: 'DIRECT', is_current: true } as any]);
    await computeGoogleTagTopologySignals('org-1', false, now);
    expect(inserts[0].row).toMatchObject({ recombined: true, check_status: 'degraded' });
  });

  it('skips a client without an OAuth GTM connection (no refreshable source), leaving nothing monitored', async () => {
    arrange({ conn: { id: 'conn-1', auth_method: 'manual_upload' } });
    expect(await computeGoogleTagTopologySignals('org-1', false, now)).toBeNull();
    expect(inserts).toHaveLength(0);
  });
});
