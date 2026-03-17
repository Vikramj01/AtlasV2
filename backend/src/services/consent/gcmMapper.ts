/**
 * Google Consent Mode v2 — State Builder (backend)
 *
 * Converts an Atlas ConsentDecisions object into a GCMState map using the
 * project-specific GCMMapping configuration stored in consent_configs.
 *
 * Used by the consent record route to persist the derived GCM state alongside
 * the raw category decisions, so the frontend banner snippet can fire
 * gtag('consent', 'update', gcmState) without recalculating.
 *
 * Re-used by the frontend consent-engine.ts (same logic, different import path).
 */

import type { ConsentDecisions, GCMMapping, GCMState, GCMSignal } from '@/types/consent';

/**
 * Derive a GCMState from visitor consent decisions and the project's GCM mapping.
 *
 * If a GCM signal is mapped to multiple categories, ANY granted category
 * results in 'granted' for that signal (union / OR semantics).
 *
 * @param decisions  Per-category consent decision ('granted' | 'denied' | 'pending' | 'not_required')
 * @param mapping    GCMMapping from consent_configs.gcm_mapping
 */
export function buildGCMState(decisions: ConsentDecisions, mapping: GCMMapping): GCMState {
  // Collect all signals we need to evaluate
  const signalVotes = new Map<GCMSignal, boolean>();

  for (const [category, signals] of Object.entries(mapping) as [keyof typeof mapping, GCMSignal[]][]) {
    const isGranted = decisions[category] === 'granted';
    for (const signal of signals) {
      // Once granted, it stays granted (OR logic across categories)
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

  // security_storage is always granted — Atlas never gates it
  gcmState['security_storage'] = 'granted';

  return gcmState;
}
