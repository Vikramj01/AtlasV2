/**
 * Which CAPI provider's token the generated Atlas Signal Tag should authenticate with.
 *
 * `/api/capi/browser-event` is authenticated by a per-provider `provider_token` and writes that
 * provider's dedup entry, so a container needs the token of ONE of the client's providers. A client
 * can have several. Preference: an `active` provider over any other status (a draft/disabled one
 * would 401 or be torn down), then the provider whose dedup flow the beacon was built for first
 * (Meta), then the other beacon-aware providers. Pure so the choice is unit-tested.
 */
import type { CAPIProvider } from '@/types/capi';

export interface BeaconTokenCandidate {
  provider: CAPIProvider;
  status: string;
  provider_token: string | null;
  created_at?: string;
}

const PROVIDER_RANK: Partial<Record<CAPIProvider, number>> = {
  meta: 0, tiktok: 1, linkedin: 2, openai: 3, google: 4,
};

export function pickBeaconToken(rows: BeaconTokenCandidate[]): string | null {
  const usable = rows.filter((r) => typeof r.provider_token === 'string' && r.provider_token.length > 0);
  if (usable.length === 0) return null;
  const ranked = [...usable].sort((a, b) => {
    const activeDiff = Number(b.status === 'active') - Number(a.status === 'active');
    if (activeDiff !== 0) return activeDiff;
    const rankDiff = (PROVIDER_RANK[a.provider] ?? 99) - (PROVIDER_RANK[b.provider] ?? 99);
    if (rankDiff !== 0) return rankDiff;
    return (a.created_at ?? '').localeCompare(b.created_at ?? ''); // oldest first: stable across runs
  });
  return ranked[0].provider_token;
}
