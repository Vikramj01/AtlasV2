/**
 * Google Consent Mode v2 — State Builder (frontend)
 *
 * Same logic as backend/src/services/consent/gcmMapper.ts.
 * Kept separate so the frontend has no dependency on the backend module.
 *
 * Usage:
 *   const gcmState = buildGCMState(decisions, config.gcm_mapping);
 *   gtag('consent', 'update', gcmState);
 */

import type { ConsentDecisions, GCMMapping, GCMState, GCMSignal } from '@/types/consent';

export const DEFAULT_GCM_MAPPING: GCMMapping = {
  analytics:       ['analytics_storage', 'functionality_storage'],
  marketing:       ['ad_storage', 'ad_user_data', 'ad_personalization'],
  personalisation: ['personalization_storage'],
  functional:      ['functionality_storage'],
};

/**
 * Convert category decisions → GCM signal map.
 * OR semantics: any granted category grants all its mapped signals.
 * security_storage is always 'granted'.
 */
export function buildGCMState(decisions: ConsentDecisions, mapping: GCMMapping = DEFAULT_GCM_MAPPING): GCMState {
  const signalVotes = new Map<GCMSignal, boolean>();

  for (const [category, signals] of Object.entries(mapping) as [keyof GCMMapping, GCMSignal[]][]) {
    const isGranted = decisions[category] === 'granted';
    for (const signal of signals) {
      if (!signalVotes.has(signal)) {
        signalVotes.set(signal, isGranted);
      } else if (isGranted) {
        signalVotes.set(signal, true);
      }
    }
  }

  const gcmState: GCMState = {};
  for (const [signal, granted] of signalVotes.entries()) {
    gcmState[signal] = granted ? 'granted' : 'denied';
  }

  gcmState['security_storage'] = 'granted';
  return gcmState;
}

/**
 * Emit a gtag consent update. Safe to call even if gtag is not loaded yet.
 */
export function pushGCMUpdate(gcmState: GCMState): void {
  if (typeof window === 'undefined') return;
  const w = window as Window & { gtag?: (...args: unknown[]) => void };
  if (typeof w.gtag === 'function') {
    w.gtag('consent', 'update', gcmState);
  }
}

/**
 * Set default consent mode before any tags fire.
 * Call this as early as possible in the page lifecycle.
 */
export function pushGCMDefault(gcmState: GCMState): void {
  if (typeof window === 'undefined') return;
  const w = window as Window & { gtag?: (...args: unknown[]) => void };
  if (typeof w.gtag === 'function') {
    w.gtag('consent', 'default', gcmState);
  }
}
