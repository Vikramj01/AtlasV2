import { describe, it, expect } from 'vitest';
import { pickBeaconToken, type BeaconTokenCandidate } from '../beaconToken';

const c = (provider: BeaconTokenCandidate['provider'], status: string, token: string | null, created_at = '2026-01-01'): BeaconTokenCandidate =>
  ({ provider, status, provider_token: token, created_at });

describe('pickBeaconToken', () => {
  it('returns null with no providers or no usable token', () => {
    expect(pickBeaconToken([])).toBeNull();
    expect(pickBeaconToken([c('meta', 'active', null), c('tiktok', 'active', '')])).toBeNull();
  });

  it('prefers Meta (the dedup flow the beacon was built for) among active providers', () => {
    expect(pickBeaconToken([c('linkedin', 'active', 'li'), c('meta', 'active', 'meta'), c('tiktok', 'active', 'tt')])).toBe('meta');
  });

  it('falls back through TikTok, LinkedIn, OpenAI, Google in that order', () => {
    expect(pickBeaconToken([c('google', 'active', 'g'), c('linkedin', 'active', 'li'), c('tiktok', 'active', 'tt')])).toBe('tt');
    expect(pickBeaconToken([c('google', 'active', 'g'), c('openai', 'active', 'oa'), c('linkedin', 'active', 'li')])).toBe('li');
    expect(pickBeaconToken([c('google', 'active', 'g'), c('openai', 'active', 'oa')])).toBe('oa');
  });

  it('an ACTIVE provider beats a higher-ranked inactive one (a draft Meta provider would 401 the beacon)', () => {
    expect(pickBeaconToken([c('meta', 'draft', 'meta-draft'), c('linkedin', 'active', 'li')])).toBe('li');
  });

  it('still returns a token when none is active (better than the placeholder), preferring rank', () => {
    expect(pickBeaconToken([c('linkedin', 'draft', 'li'), c('meta', 'draft', 'meta')])).toBe('meta');
  });

  it('breaks a tie deterministically: the oldest provider of the same type and status', () => {
    expect(pickBeaconToken([c('meta', 'active', 'newer', '2026-06-01'), c('meta', 'active', 'older', '2026-01-01')])).toBe('older');
  });

  it('skips a provider without a token rather than returning an empty one', () => {
    expect(pickBeaconToken([c('meta', 'active', null), c('tiktok', 'active', 'tt')])).toBe('tt');
  });

  it('does not mutate its input', () => {
    const rows = [c('linkedin', 'active', 'li'), c('meta', 'active', 'meta')];
    pickBeaconToken(rows);
    expect(rows.map((r) => r.provider)).toEqual(['linkedin', 'meta']);
  });
});
