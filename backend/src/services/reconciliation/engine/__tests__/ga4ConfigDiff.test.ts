/**
 * GA4 Admin / L11 / Junk Gate PRD §A.4 (AC 3): no finding for a GA4 connection
 * with no client association / no snapshot, plus the loader's pure helpers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let ga4Conns: unknown[];
let snapshotRow: unknown;
vi.mock('@/services/database/supabase', () => {
  const make = (table: string) => {
    const chain: any = {};
    for (const m of ['select', 'eq', 'order', 'limit', 'in', 'lt', 'gte']) chain[m] = () => chain;
    chain.maybeSingle = async () => ({ data: table === 'ga4_config_snapshots' ? snapshotRow : null, error: null });
    chain.then = (resolve: Function) => resolve({ data: table === 'platform_connections' ? ga4Conns : [], error: null });
    return chain;
  };
  return { supabaseAdmin: { from: (t: string) => make(t) } };
});
vi.mock('../findingWriter', () => ({ writeFinding: vi.fn() }));
vi.mock('@/utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { writeFinding } from '../findingWriter';
import { runGa4ConfigDiff, ga4MeasurementIdsFromContainer, conversionGa4EventsFromStageActions } from '../ga4ConfigDiff';
import type { GTMContainerSnapshot } from '@/types/audit';

beforeEach(() => {
  vi.mocked(writeFinding).mockReset();
  ga4Conns = [];
  snapshotRow = null;
});

describe('runGa4ConfigDiff — client association', () => {
  it('writes nothing when the client has no GA4 connection', async () => {
    await runGa4ConfigDiff('run-1', 'client-1', 'org-1');
    expect(writeFinding).not.toHaveBeenCalled();
  });

  it('writes nothing when the connection has no snapshot yet', async () => {
    ga4Conns = [{ id: 'c1', account_id: '123', last_synced_at: null }];
    await runGa4ConfigDiff('run-1', 'client-1', 'org-1');
    expect(writeFinding).not.toHaveBeenCalled();
  });

  it('writes nothing when a snapshot exists but no context rule can fire (no container, hosts, Ads or events known)', async () => {
    ga4Conns = [{ id: 'c1', account_id: '123', last_synced_at: null }];
    snapshotRow = { snapshot: {
      property_id: '123', currency_code: 'GBP', time_zone: 'UTC', ads_links: null, data_retention: null,
      web_streams: [{ stream_id: '9', measurement_id: 'G-REAL1', default_uri: null, enhanced_measurement: null }],
    } };
    await runGa4ConfigDiff('run-1', 'client-1', 'org-1');
    expect(writeFinding).not.toHaveBeenCalled();
  });
});

const container = (tags: GTMContainerSnapshot['tags'], variables: GTMContainerSnapshot['variables'] = []): GTMContainerSnapshot => ({
  container_id: 'GTM-X', fetched_at: '', source: 'gtm_api', tags, triggers: [], variables, built_in_variables: [], consent_default_tag: null,
});

describe('ga4MeasurementIdsFromContainer', () => {
  it('resolves a googtag ID through a constant variable, upper-cased', () => {
    const c = container(
      [{ tagId: '1', name: 'GA4', type: 'googtag', firingTriggerId: [], parameter: [{ type: 'template', key: 'tagId', value: '{{CONST - GA4 Measurement ID}}' }] }],
      [{ variableId: '1', name: 'CONST - GA4 Measurement ID', type: 'c', parameter: [{ type: 'template', key: 'value', value: 'g-abc123' }] } as never],
    );
    expect(ga4MeasurementIdsFromContainer(c)).toEqual(['G-ABC123']);
  });

  it('reads a legacy gaawc measurementId', () => {
    const c = container([{ tagId: '1', name: 'GA4', type: 'gaawc', firingTriggerId: [], parameter: [{ type: 'template', key: 'measurementId', value: 'G-LEGACY1' }] }]);
    expect(ga4MeasurementIdsFromContainer(c)).toEqual(['G-LEGACY1']);
  });

  it('skips an Ads googtag and an unresolvable ID — never guessed', () => {
    const c = container([
      { tagId: '1', name: 'Ads', type: 'googtag', firingTriggerId: [], parameter: [{ type: 'template', key: 'tagId', value: 'AW-123' }] },
      { tagId: '2', name: 'Mystery', type: 'googtag', firingTriggerId: [], parameter: [{ type: 'template', key: 'tagId', value: '{{DLV - something}}' }] },
    ]);
    expect(ga4MeasurementIdsFromContainer(c)).toEqual([]);
  });
});

describe('conversionGa4EventsFromStageActions', () => {
  it('maps conversion-category actions to their GA4 event names and ignores engagement actions', () => {
    expect(conversionGa4EventsFromStageActions([['purchase', 'add_to_cart'], ['generate_lead'], ['not_a_real_action']]).sort())
      .toEqual(['generate_lead', 'purchase']);
  });
  it('returns nothing for no conversion stages', () => {
    expect(conversionGa4EventsFromStageActions([['add_to_cart']])).toEqual([]);
  });
});
