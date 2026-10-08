/**
 * server_only vs hybrid classification (PRD §C.3) — honest about what holding can stop.
 *
 * Atlas can only withhold the copy IT sends. If a browser pixel / Google tag can also fire the
 * same conversion client-side, holding the server copy removes only the server copy and the
 * platform still receives the browser event ("hybrid"). Atlas has no per-event record of whether
 * a client's browser tag fires the same event (there is no deployment-level transport flag), so
 * the classification is by DESTINATION: a destination Atlas reaches only through server-side
 * delivery (LinkedIn's Conversions API has no equivalent Atlas-generated browser tag) is
 * `server_only`; every destination with a standard browser pixel/tag (Meta, Google, TikTok,
 * Microsoft, Amazon, OpenAI) is conservatively `hybrid`. A single hybrid destination makes the
 * whole event `hybrid` — the label exists to stop anyone believing junk was blocked when it was not.
 */
import type { CAPIProvider } from '@/types/capi';

export type DeliveryClass = 'server_only' | 'hybrid';

const SERVER_ONLY_PROVIDERS: ReadonlySet<CAPIProvider> = new Set<CAPIProvider>(['linkedin']);

export function classifyDestination(provider: CAPIProvider): DeliveryClass {
  return SERVER_ONLY_PROVIDERS.has(provider) ? 'server_only' : 'hybrid';
}

export function classifyDelivery(providers: CAPIProvider[]): DeliveryClass {
  if (providers.length === 0) return 'hybrid';
  return providers.every((p) => classifyDestination(p) === 'server_only') ? 'server_only' : 'hybrid';
}
