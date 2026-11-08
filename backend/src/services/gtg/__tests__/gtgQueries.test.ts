import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/database/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }));

import { supabaseAdmin } from '@/services/database/supabase';
import { applyCaptureGtgStatus, captureEvidence } from '@/services/database/gtgQueries';
import { contextForSite } from '@/services/google/googleEndpointMatcher';
import { DIRECT_REQUESTS, GTG_REQUESTS, GTG_SITE_URL, req } from '../../audit/__tests__/fixtures/gtgSite';

function mockClient(current: unknown) {
  const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
  vi.mocked(supabaseAdmin.from).mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: { gtg_status: current }, error: null }) }),
    }),
    update,
  } as never);
  return update;
}

describe('captureEvidence', () => {
  const ctx = contextForSite(GTG_SITE_URL);
  it('gateway capture: first-party gateway load, no Google-direct load', () => {
    expect(captureEvidence(GTG_REQUESTS, ctx)).toEqual({ hasFirstPartyLoad: true, hasGoogleDirectLoad: false, firstPartyIsGateway: true });
  });
  it('pre-gateway capture: Google-direct load only', () => {
    expect(captureEvidence(DIRECT_REQUESTS, ctx)).toEqual({ hasFirstPartyLoad: false, hasGoogleDirectLoad: true, firstPartyIsGateway: false });
  });
  it('hits alone are not loads', () => {
    expect(captureEvidence([req('https://www.example.com/metrics/g/collect?tid=G-ABCDEF1234')], ctx))
      .toEqual({ hasFirstPartyLoad: false, hasGoogleDirectLoad: false, firstPartyIsGateway: false });
  });
});

describe('applyCaptureGtgStatus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes detected_unverified for a gateway capture on an unknown client (AC: no GTM connection needed)', async () => {
    const update = mockClient('unknown');
    expect(await applyCaptureGtgStatus('c1', GTG_SITE_URL, GTG_REQUESTS)).toBe('detected_unverified');
    expect(update.mock.calls[0][0]).toMatchObject({ gtg_status: 'detected_unverified' });
  });
  it('writes not_detected when only Google-direct loads were seen', async () => {
    mockClient('unknown');
    expect(await applyCaptureGtgStatus('c1', GTG_SITE_URL, DIRECT_REQUESTS)).toBe('not_detected');
  });
  it('does not touch a verified client', async () => {
    const update = mockClient('verified');
    expect(await applyCaptureGtgStatus('c1', GTG_SITE_URL, DIRECT_REQUESTS)).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });
  it('does not overwrite anything when the capture saw no loader', async () => {
    const update = mockClient('not_detected');
    expect(await applyCaptureGtgStatus('c1', GTG_SITE_URL, [req('https://www.example.com/app.js')])).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });
  it('treats a junk stored value as unknown', async () => {
    mockClient('garbage');
    expect(await applyCaptureGtgStatus('c1', GTG_SITE_URL, DIRECT_REQUESTS)).toBe('not_detected');
  });
});
