import { describe, it, expect, vi, beforeEach } from 'vitest';

const logged: unknown[] = [];
vi.mock('@/utils/logger', () => ({
  default: { info: (...a: unknown[]) => logged.push(a), warn: (...a: unknown[]) => logged.push(a), error: (...a: unknown[]) => logged.push(a), debug: (...a: unknown[]) => logged.push(a) },
}));
const q = vi.hoisted(() => ({ getBeaconProviderTokenForClient: vi.fn(), getClientIdentityConfig: vi.fn() }));
vi.mock('@/services/database/capiQueries', () => ({ getBeaconProviderTokenForClient: q.getBeaconProviderTokenForClient }));
vi.mock('@/services/database/enrichmentQueries', () => ({ getClientIdentityConfig: q.getClientIdentityConfig }));

import { resolveBeaconInputs } from '../beaconInputs';

const TOKEN = '6f1c2f64-0000-4000-8000-aaaaaaaaaaaa';

beforeEach(() => {
  vi.clearAllMocks();
  logged.length = 0;
  q.getBeaconProviderTokenForClient.mockResolvedValue(TOKEN);
  q.getClientIdentityConfig.mockResolvedValue({ honeypot_selector: 'input[name="website"]' });
});

describe('resolveBeaconInputs', () => {
  it('resolves the provider token and the honeypot selector', async () => {
    expect(await resolveBeaconInputs('client-1')).toEqual({ provider_token: TOKEN, junk_honeypot_selector: 'input[name="website"]' });
  });

  it('leaves each value unset when there is nothing to resolve', async () => {
    q.getBeaconProviderTokenForClient.mockResolvedValue(null);
    q.getClientIdentityConfig.mockResolvedValue(null);
    expect(await resolveBeaconInputs('client-1')).toEqual({});
  });

  it('a token lookup failure is non-fatal and does not stop the selector lookup', async () => {
    q.getBeaconProviderTokenForClient.mockRejectedValue(new Error('db down'));
    expect(await resolveBeaconInputs('client-1')).toEqual({ junk_honeypot_selector: 'input[name="website"]' });
  });

  it('a selector lookup failure is non-fatal and keeps the token', async () => {
    q.getClientIdentityConfig.mockRejectedValue(new Error('db down'));
    expect(await resolveBeaconInputs('client-1')).toEqual({ provider_token: TOKEN });
  });

  it('re-validates a stored selector: an unsafe value written before the allow-list never reaches generated JS', async () => {
    q.getClientIdentityConfig.mockResolvedValue({ honeypot_selector: "x');alert(1);//" });
    expect(await resolveBeaconInputs('client-1')).toEqual({ provider_token: TOKEN });
  });

  it('never logs the provider token', async () => {
    q.getBeaconProviderTokenForClient.mockRejectedValue(new Error('boom'));
    await resolveBeaconInputs('client-1');
    await resolveBeaconInputs('client-1');
    expect(JSON.stringify(logged)).not.toContain(TOKEN);
  });
});
