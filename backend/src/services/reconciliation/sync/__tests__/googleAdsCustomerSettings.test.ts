/**
 * GA4 Admin / L11 / Junk Gate PRD Part A (AC 5): the Ads customer currency/time
 * zone read goes through the shared GOOGLE_ADS_API_VERSION and is merged into
 * connection metadata without clobbering other keys.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let connRow: unknown;
const updates: Array<Record<string, unknown>> = [];

vi.mock('@/services/database/supabase', () => {
  const chain: any = {};
  chain.select = () => chain; chain.eq = () => chain;
  chain.single = async () => ({ data: connRow, error: null });
  chain.update = (v: Record<string, unknown>) => { updates.push(v); return { eq: async () => ({ error: null }) }; };
  return { supabaseAdmin: { from: () => chain } };
});
vi.mock('@/services/connections/tokenManager', () => ({ resolveTokens: vi.fn(async () => ({ access_token: 'tok' })) }));
vi.mock('@/config/env', () => ({ env: { GOOGLE_ADS_DEVELOPER_TOKEN: 'dev' } }));
vi.mock('@/utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { syncCustomerSettings } from '../googleAdsSync';
import { GOOGLE_ADS_API_VERSION } from '@/integrations/google/adsApiVersion';

beforeEach(() => {
  updates.length = 0;
  connRow = { account_id: '123-456-7890', metadata: { keep: 'me' } };
});

describe('syncCustomerSettings', () => {
  it('queries via GOOGLE_ADS_API_VERSION and merges currency/time zone into metadata', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => [{ results: [{ customer: { id: '1', currencyCode: 'GBP', timeZone: 'Europe/London' } }] }] }));
    vi.stubGlobal('fetch', fetchMock);
    await syncCustomerSettings('conn-1');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe(`https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/1234567890/googleAds:searchStream`);
    expect(init.body).toContain('customer.currency_code');
    expect(updates).toHaveLength(1);
    expect(updates[0].metadata).toMatchObject({ keep: 'me', ads_customer: { currency_code: 'GBP', time_zone: 'Europe/London' } });
  });

  it('writes nothing when the response carries no customer row', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{ results: [] }] })));
    await syncCustomerSettings('conn-1');
    expect(updates).toHaveLength(0);
  });
});
