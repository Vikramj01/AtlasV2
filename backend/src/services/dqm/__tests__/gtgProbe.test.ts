/**
 * Google tag gateway probe (docs/prd/google-tag-gateway.md §6.3).
 * Fetch is injected, so nothing here touches the network or global mocks.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/services/database/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }));

import {
  classifyGeoResponse,
  classifyHealthyResponse,
  probeGtgEndpoint,
  probeGtgEndpoints,
  summariseByClient,
  GTG_PROBE_USER_AGENT,
  type GtgEndpointRow,
  type GtgFetch,
} from '../gtgProbe';

const EP: GtgEndpointRow = {
  id: 'ep-1', org_id: 'org-1', client_id: 'client-1', hostname: 'www.example.com', reserved_path: '/metrics', tag_or_container: 'GTM-ABC1234',
};

function res(status: number, body = '', contentType = 'text/plain') {
  return { status, ok: status >= 200 && status < 300, headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? contentType : null) }, text: async () => body };
}

/** Routes /healthy and ?validate_geo=healthy to different canned responses. */
function fetchFor(healthy: ReturnType<typeof res> | Error, geo: ReturnType<typeof res> | Error = res(200, 'ok')): GtgFetch & ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string) => {
    const r = url.includes('validate_geo') ? geo : healthy;
    if (r instanceof Error) throw r;
    return r;
  }) as never;
}

describe('classifyHealthyResponse', () => {
  it('200 + ok passes (case/whitespace tolerant)', () => {
    expect(classifyHealthyResponse(200, 'ok', 'text/plain')).toBe('pass');
    expect(classifyHealthyResponse(200, ' OK\n', 'text/plain')).toBe('pass');
  });
  it('a catch-all 200 web page does NOT pass', () => {
    expect(classifyHealthyResponse(200, '<!doctype html><html>', 'text/html')).toBe('fail_not_routed');
    expect(classifyHealthyResponse(200, '<div>Not found</div>', 'text/plain')).toBe('fail_not_routed');
  });
  it('a short non-ok plain-text 200 is an unexpected body, never a fail (Google may have changed the contract)', () => {
    expect(classifyHealthyResponse(200, 'healthy', 'text/plain')).toBe('unexpected_body');
  });
  it('403 and 429 mean back off', () => {
    expect(classifyHealthyResponse(403, '', '')).toBe('rate_limited');
    expect(classifyHealthyResponse(429, '', '')).toBe('rate_limited');
  });
  it('404 and 5xx are failures', () => {
    expect(classifyHealthyResponse(404, '', '')).toBe('fail_http');
    expect(classifyHealthyResponse(503, '', '')).toBe('fail_http');
  });
});

describe('classifyGeoResponse', () => {
  it('200 + ok → pass; any other answer on a reachable path → fail; blocked → skipped', () => {
    expect(classifyGeoResponse(200, 'ok')).toBe('pass');
    expect(classifyGeoResponse(200, 'location header missing')).toBe('fail');
    expect(classifyGeoResponse(400, 'bad')).toBe('fail');
    expect(classifyGeoResponse(429, '')).toBe('skipped');
  });
});

describe('probeGtgEndpoint', () => {
  it('both checks pass → verdict ok, probing the registered client path', async () => {
    const f = fetchFor(res(200, 'ok'), res(200, 'ok'));
    const r = await probeGtgEndpoint(EP, 2000, { fetchImpl: f });
    expect(r).toMatchObject({ pathStatus: 'pass', geoStatus: 'pass', verdict: 'ok', rateLimited: false });
    expect(f.mock.calls.map((c) => c[0])).toEqual([
      'https://www.example.com/metrics/healthy',
      'https://www.example.com/metrics/?validate_geo=healthy',
    ]);
  });

  it('identifies Atlas in the User-Agent', async () => {
    const f = fetchFor(res(200, 'ok'));
    await probeGtgEndpoint(EP, 2000, { fetchImpl: f });
    expect((f.mock.calls[0][1] as { headers: Record<string, string> }).headers['User-Agent']).toBe(GTG_PROBE_USER_AGENT);
  });

  it('/healthy ok but geo fails → verified-no-geo verdict', async () => {
    const r = await probeGtgEndpoint(EP, 2000, { fetchImpl: fetchFor(res(200, 'ok'), res(200, 'location headers missing')) });
    expect(r).toMatchObject({ pathStatus: 'pass', geoStatus: 'fail', verdict: 'no_geo' });
    expect(r.errorMessage).toMatch(/location/i);
  });

  it('a deliberately broken path (404) → broken, and geo is not attempted', async () => {
    const f = fetchFor(res(404, 'Not found'));
    const r = await probeGtgEndpoint(EP, 2000, { fetchImpl: f });
    expect(r).toMatchObject({ pathStatus: 'fail', geoStatus: 'skipped', verdict: 'broken', httpStatus: 404 });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('a catch-all 200 page → broken (the path is not routed to the gateway)', async () => {
    const r = await probeGtgEndpoint(EP, 2000, { fetchImpl: fetchFor(res(200, '<html>Welcome</html>', 'text/html; charset=utf-8')) });
    expect(r).toMatchObject({ pathStatus: 'fail', verdict: 'broken' });
  });

  it('an unexpected plain body → inconclusive, not broken', async () => {
    const r = await probeGtgEndpoint(EP, 2000, { fetchImpl: fetchFor(res(200, 'healthy')) });
    expect(r).toMatchObject({ pathStatus: 'error', verdict: 'inconclusive' });
  });

  it('429 → inconclusive, rate limited, geo skipped', async () => {
    const f = fetchFor(res(429));
    const r = await probeGtgEndpoint(EP, 2000, { fetchImpl: f });
    expect(r).toMatchObject({ pathStatus: 'error', geoStatus: 'skipped', rateLimited: true, verdict: 'inconclusive' });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('a timeout → broken', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const r = await probeGtgEndpoint(EP, 2000, { fetchImpl: fetchFor(abort) });
    expect(r).toMatchObject({ pathStatus: 'timeout', verdict: 'broken' });
  });

  it('a network error (e.g. DNS) → inconclusive: could be Atlas, not the client', async () => {
    const r = await probeGtgEndpoint(EP, 2000, { fetchImpl: fetchFor(new Error('getaddrinfo ENOTFOUND')) });
    expect(r).toMatchObject({ pathStatus: 'error', verdict: 'inconclusive' });
  });

  it('geo check blocked or unreachable → inconclusive (cannot claim verified)', async () => {
    const r = await probeGtgEndpoint(EP, 2000, { fetchImpl: fetchFor(res(200, 'ok'), res(429)) });
    expect(r).toMatchObject({ pathStatus: 'pass', geoStatus: 'skipped', verdict: 'inconclusive' });
  });

  it('slow but correct → degraded path, still ok', async () => {
    const slow: GtgFetch = async (url) => {
      await new Promise((r) => setTimeout(r, 30));
      return res(200, 'ok') as never;
    };
    const r = await probeGtgEndpoint(EP, 10, { fetchImpl: slow });
    expect(r).toMatchObject({ pathStatus: 'degraded', geoStatus: 'pass', verdict: 'ok' });
  });

  it('refuses to probe a host the SSRF guard rejects', async () => {
    const f = fetchFor(res(200, 'ok'));
    const r = await probeGtgEndpoint({ ...EP, hostname: '169.254.169.254' }, 2000, { fetchImpl: f });
    expect(r.pathStatus).toBe('error');
    expect(f).not.toHaveBeenCalled();
  });
});

describe('probeGtgEndpoints', () => {
  it('backs off a host that rate-limits: its other endpoints are skipped, not hammered', async () => {
    const f = fetchFor(res(429));
    const results = await probeGtgEndpoints(
      [EP, { ...EP, id: 'ep-2', reserved_path: '/other' }, { ...EP, id: 'ep-3', hostname: 'shop.example.com' }],
      2000,
      { fetchImpl: f },
    );
    expect(results.map((r) => r.verdict)).toEqual(['inconclusive', 'inconclusive', 'inconclusive']);
    // ep-1 hit the wire; ep-2 shares its host and was skipped; ep-3 is another host and was tried.
    expect(f).toHaveBeenCalledTimes(2);
    expect(results[1].errorMessage).toMatch(/rate-limited/);
  });

  it('rolls results up per client: any broken endpoint makes the client broken', async () => {
    const results = await probeGtgEndpoints([EP, { ...EP, id: 'ep-2', reserved_path: '/b' }], 2000, {
      fetchImpl: vi.fn(async (url: string) => (url.includes('/b/') ? res(404) : res(200, 'ok'))) as never,
    });
    expect(summariseByClient(results).get('client-1')).toBe('broken');
  });
});
