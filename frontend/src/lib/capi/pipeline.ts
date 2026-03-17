/**
 * Client-Side CAPI Pipeline
 *
 * Lightweight browser-side pipeline that:
 *   1. Checks consent for the target provider
 *   2. Runs client-side dedup (60s window)
 *   3. Hashes PII (SHA-256 via Web Crypto API)
 *   4. POSTs to backend /api/capi/process (server handles delivery)
 *
 * Usage:
 *   await pipeline.track('purchase', eventData, { provider_id: 'xxx' });
 */

import type { AtlasEvent, CAPIProvider, HashedIdentifier } from '@/types/capi';
import type { ConsentDecisions } from '@/types/consent';
import { hashUserData } from '@/lib/capi/hash-pii';
import { clientDedup } from '@/lib/capi/dedup';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TrackOptions {
  /** Provider config ID from the Atlas backend */
  provider_id: string;
  /** Auth token — required for /api/capi/process */
  auth_token: string;
  /** Skip client-side dedup check (default: false) */
  skip_dedup?: boolean;
}

export interface TrackResult {
  event_id: string;
  status: 'delivered' | 'failed' | 'consent_blocked' | 'dedup_skipped' | 'enqueued';
  error?: string;
}

// ── Consent check ─────────────────────────────────────────────────────────────

function checkConsent(decisions: ConsentDecisions | null, provider: CAPIProvider): boolean {
  if (!decisions) return false;
  switch (provider) {
    case 'meta':   return decisions.marketing === 'granted';
    case 'google': return decisions.analytics === 'granted';
    default:       return decisions.marketing === 'granted';
  }
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

/**
 * Send an AtlasEvent through the CAPI pipeline.
 *
 * @param event         The Atlas event to send
 * @param provider      Provider type (for consent check)
 * @param decisions     Current consent decisions (from consentStore)
 * @param options       Provider config ID + auth token
 */
export async function trackEvent(
  event: AtlasEvent,
  provider: CAPIProvider,
  decisions: ConsentDecisions | null,
  options: TrackOptions,
): Promise<TrackResult> {
  // 1. Consent gate
  if (!checkConsent(decisions, provider)) {
    return { event_id: event.event_id, status: 'consent_blocked' };
  }

  // 2. Client-side dedup
  if (!options.skip_dedup && clientDedup.check(event.event_id)) {
    return { event_id: event.event_id, status: 'dedup_skipped' };
  }

  // 3. Hash PII — all identifiers enabled by default; server applies the
  //    provider's identifier_config filter
  const identifiers: HashedIdentifier[] = await hashUserData(event.user_data, [
    'email', 'phone', 'fn', 'ln', 'ct', 'st', 'zp', 'country',
    'external_id', 'fbc', 'fbp', 'gclid', 'wbraid', 'gbraid',
  ]);

  // 4. POST to backend pipeline
  try {
    const res = await fetch(`${API_BASE}/api/capi/process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.auth_token}`,
      },
      body: JSON.stringify({
        provider_id: options.provider_id,
        event: { ...event, _hashed_identifiers: identifiers },
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string; message?: string };
      return {
        event_id: event.event_id,
        status: 'failed',
        error: body.message ?? body.error ?? `HTTP ${res.status}`,
      };
    }

    const result = await res.json() as TrackResult;
    return result;
  } catch (err) {
    return {
      event_id: event.event_id,
      status: 'failed',
      error: err instanceof Error ? err.message : 'Network error',
    };
  }
}

// ── Convenience builder ───────────────────────────────────────────────────────

/**
 * Create an AtlasEvent with sensible defaults.
 */
export function buildAtlasEvent(
  eventName: string,
  overrides: Partial<AtlasEvent> = {},
): AtlasEvent {
  return {
    event_id: generateEventId(),
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_source_url: typeof window !== 'undefined' ? window.location.href : '',
    action_source: 'website',
    user_data: {},
    consent_state: { analytics: 'pending', marketing: 'pending', personalisation: 'pending', functional: 'granted' },
    ...overrides,
  };
}

function generateEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
