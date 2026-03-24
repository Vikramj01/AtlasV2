/**
 * CMP Listener Bridges — OneTrust, Cookiebot, Usercentrics
 *
 * Translates each CMP's consent change events into Atlas ConsentDecisions.
 * Runs in the browser (WalkerOS integration layer).
 *
 * All listeners:
 *   - Are defensive: never throw if the CMP window object is absent
 *   - Return a cleanup function that removes all attached event listeners
 *   - Never log PII
 */

import type { ConsentDecisions, ConsentMode, ConsentCategory, ConsentState } from '@/types/consent';

// ── Public interface ───────────────────────────────────────────────────────────

export interface CMPListenerCallbacks {
  onConsentChange: (decisions: ConsentDecisions, source: ConsentMode) => void;
  onReady?: () => void;
}

// ── Internal helpers ───────────────────────────────────────────────────────────

const ALL_CATEGORIES: ConsentCategory[] = ['analytics', 'marketing', 'personalisation', 'functional'];

function buildDeniedDecisions(): ConsentDecisions {
  return {
    analytics: 'denied',
    marketing: 'denied',
    personalisation: 'denied',
    functional: 'denied',
  };
}

/**
 * Given a set of active (granted) CMP-specific category IDs and a user-configured
 * category_mapping, produce an Atlas ConsentDecisions object.
 * Categories not found in activeIds are set to 'denied'.
 * Categories without a mapping entry are ignored (not present in output).
 */
function mapActiveIdsToDecisions(
  activeIds: Set<string>,
  categoryMapping: Record<string, ConsentCategory>,
): ConsentDecisions {
  const decisions = buildDeniedDecisions();

  for (const [cmpId, atlasCategory] of Object.entries(categoryMapping)) {
    if (activeIds.has(cmpId)) {
      decisions[atlasCategory] = 'granted';
    }
  }

  return decisions;
}

// ── OneTrust ──────────────────────────────────────────────────────────────────

interface OneTrustWindow {
  OneTrust?: {
    GetDomainData?: () => {
      Groups?: Array<{ CustomGroupId: string; Status: string }>;
    };
    IsAlertBoxClosed?: () => boolean;
  };
  OnetrustActiveGroups?: string;
}

/**
 * Extract the set of active (consented) OneTrust group IDs.
 * OneTrust populates `window.OnetrustActiveGroups` as a comma-separated list,
 * e.g. ",C0001,C0002,". We also fall back to GetDomainData().Groups.
 */
function getOneTrustActiveGroups(win: OneTrustWindow): Set<string> {
  const active = new Set<string>();

  // Primary: OnetrustActiveGroups string (always up-to-date after user interaction)
  if (typeof win.OnetrustActiveGroups === 'string') {
    win.OnetrustActiveGroups.split(',').forEach((id) => {
      const trimmed = id.trim();
      if (trimmed) active.add(trimmed);
    });
    return active;
  }

  // Fallback: GetDomainData API
  try {
    const groups = win.OneTrust?.GetDomainData?.()?.Groups ?? [];
    for (const group of groups) {
      if (group.Status === 'always active' || group.Status === '1') {
        active.add(group.CustomGroupId);
      }
    }
  } catch {
    // Defensive — GetDomainData may not be available yet
  }

  return active;
}

/**
 * OneTrust listener.
 *
 * Listens for:
 *   - `OneTrustGroupsUpdated` (fires when user saves preferences — preferred)
 *   - `consent.onetrust` (legacy / custom event some deployments use)
 *
 * The event payload for OneTrustGroupsUpdated is an array of active group IDs.
 * We map those through the user's category_mapping to produce ConsentDecisions.
 */
export function startOneTrustListener(
  callbacks: CMPListenerCallbacks,
  categoryMapping: Record<string, ConsentCategory> = {},
): () => void {
  if (typeof window === 'undefined') return () => undefined;

  const win = window as Window & OneTrustWindow;

  function handleGroupsUpdated(event: Event): void {
    try {
      const customEvent = event as CustomEvent<string[]>;
      const activeIds = new Set<string>(
        Array.isArray(customEvent.detail) ? customEvent.detail : [],
      );

      // If detail is missing/empty, fall back to reading window.OnetrustActiveGroups
      if (activeIds.size === 0) {
        getOneTrustActiveGroups(win).forEach((id) => activeIds.add(id));
      }

      const decisions = mapActiveIdsToDecisions(activeIds, categoryMapping);
      callbacks.onConsentChange(decisions, 'onetrust');
    } catch {
      // Defensive — never throw from event handler
    }
  }

  function handleLegacyConsentEvent(): void {
    try {
      const activeIds = getOneTrustActiveGroups(win);
      const decisions = mapActiveIdsToDecisions(activeIds, categoryMapping);
      callbacks.onConsentChange(decisions, 'onetrust');
    } catch {
      // Defensive
    }
  }

  window.addEventListener('OneTrustGroupsUpdated', handleGroupsUpdated);
  window.addEventListener('consent.onetrust', handleLegacyConsentEvent);

  // Fire onReady if OneTrust is already initialised
  if (win.OneTrust) {
    try {
      callbacks.onReady?.();
      // Emit current state on init if user already consented
      const activeIds = getOneTrustActiveGroups(win);
      if (activeIds.size > 0) {
        const decisions = mapActiveIdsToDecisions(activeIds, categoryMapping);
        callbacks.onConsentChange(decisions, 'onetrust');
      }
    } catch {
      // Defensive
    }
  }

  return () => {
    window.removeEventListener('OneTrustGroupsUpdated', handleGroupsUpdated);
    window.removeEventListener('consent.onetrust', handleLegacyConsentEvent);
  };
}

// ── Cookiebot ─────────────────────────────────────────────────────────────────

interface CookiebotConsent {
  necessary: boolean;
  preferences: boolean;
  statistics: boolean;
  marketing: boolean;
}

interface CookiebotWindow {
  Cookiebot?: {
    consent?: CookiebotConsent;
    hasResponse?: boolean;
  };
}

/**
 * Map Cookiebot's fixed consent categories to Atlas ConsentDecisions.
 * Cookiebot mapping is deterministic — no user-configured mapping needed:
 *   necessary   → functional  (always granted)
 *   preferences → personalisation
 *   statistics  → analytics
 *   marketing   → marketing
 */
function mapCookiebotConsent(consent: CookiebotConsent): ConsentDecisions {
  return {
    functional: consent.necessary ? 'granted' : 'denied',
    personalisation: consent.preferences ? 'granted' : 'denied',
    analytics: consent.statistics ? 'granted' : 'denied',
    marketing: consent.marketing ? 'granted' : 'denied',
  };
}

/**
 * Cookiebot listener.
 *
 * Listens for:
 *   - `CookiebotOnConsentReady` (fires on page load if consent already recorded)
 *   - `CookiebotOnAccept`       (user clicks Accept)
 *   - `CookiebotOnDecline`      (user clicks Decline)
 *   - `CookiebotOnDialogDisplay` (banner shown — signals CMP is ready)
 *
 * Consent state is always read from `window.Cookiebot.consent` at event time.
 */
export function startCookiebotListener(callbacks: CMPListenerCallbacks): () => void {
  if (typeof window === 'undefined') return () => undefined;

  const win = window as Window & CookiebotWindow;

  function readAndEmit(): void {
    try {
      const consent = win.Cookiebot?.consent;
      if (!consent) return;
      const decisions = mapCookiebotConsent(consent);
      callbacks.onConsentChange(decisions, 'cookiebot');
    } catch {
      // Defensive
    }
  }

  function handleDialogDisplay(): void {
    try {
      callbacks.onReady?.();
    } catch {
      // Defensive
    }
  }

  window.addEventListener('CookiebotOnConsentReady', readAndEmit);
  window.addEventListener('CookiebotOnAccept', readAndEmit);
  window.addEventListener('CookiebotOnDecline', readAndEmit);
  window.addEventListener('CookiebotOnDialogDisplay', handleDialogDisplay);

  // If Cookiebot is already loaded and has a response, emit current state immediately
  if (win.Cookiebot?.hasResponse) {
    readAndEmit();
    callbacks.onReady?.();
  }

  return () => {
    window.removeEventListener('CookiebotOnConsentReady', readAndEmit);
    window.removeEventListener('CookiebotOnAccept', readAndEmit);
    window.removeEventListener('CookiebotOnDecline', readAndEmit);
    window.removeEventListener('CookiebotOnDialogDisplay', handleDialogDisplay);
  };
}

// ── Usercentrics ──────────────────────────────────────────────────────────────

interface UCService {
  id?: string;
  templateId?: string;
  name?: string;
  consent?: {
    status: boolean;
  };
}

interface UCWindow {
  UC_UI?: {
    getServicesBaseInfo?: () => UCService[];
    isInitialized?: () => boolean;
  };
}

type UCEventDetail =
  | { type: 'CONSENT_ACCEPTED' }
  | { type: 'CONSENT_DENIED' }
  | { type: 'UI_INITIALIZED' }
  | { type: string };

/**
 * Build ConsentDecisions from Usercentrics service list.
 * Maps service templateId or name to Atlas categories via category_mapping.
 * Any Atlas category with at least one granted service is set to 'granted'.
 */
function mapUCServices(
  services: UCService[],
  categoryMapping: Record<string, ConsentCategory>,
): ConsentDecisions {
  const decisions = buildDeniedDecisions();

  for (const service of services) {
    const isGranted = service.consent?.status === true;
    if (!isGranted) continue;

    // Try to match by templateId first, then name
    const keys = [service.templateId, service.name].filter(Boolean) as string[];
    for (const key of keys) {
      const atlasCategory = categoryMapping[key];
      if (atlasCategory) {
        decisions[atlasCategory] = 'granted';
      }
    }
  }

  return decisions;
}

/**
 * Usercentrics listener.
 *
 * Listens for:
 *   - `UC_UI_INITIALIZED`  (UC UI is ready — call getServicesBaseInfo)
 *   - `ucEvent`            (custom event with detail.type indicating consent change)
 *
 * `window.UC_UI.getServicesBaseInfo()` returns service objects with consent.status.
 * We map service templateId / name to Atlas categories via the user's category_mapping.
 */
export function startUsercentricsListener(
  callbacks: CMPListenerCallbacks,
  categoryMapping: Record<string, ConsentCategory> = {},
): () => void {
  if (typeof window === 'undefined') return () => undefined;

  const win = window as Window & UCWindow;

  function readAndEmit(): void {
    try {
      const services = win.UC_UI?.getServicesBaseInfo?.() ?? [];
      const decisions = mapUCServices(services, categoryMapping);
      callbacks.onConsentChange(decisions, 'usercentrics');
    } catch {
      // Defensive — UC_UI may not be ready yet
    }
  }

  function handleUCEvent(event: Event): void {
    try {
      const detail = (event as CustomEvent<UCEventDetail>).detail;
      if (!detail) return;

      if (
        detail.type === 'CONSENT_ACCEPTED' ||
        detail.type === 'CONSENT_DENIED' ||
        detail.type === 'UI_INITIALIZED'
      ) {
        if (detail.type === 'UI_INITIALIZED') {
          callbacks.onReady?.();
        }
        readAndEmit();
      }
    } catch {
      // Defensive
    }
  }

  function handleUCInitialized(): void {
    try {
      callbacks.onReady?.();
      readAndEmit();
    } catch {
      // Defensive
    }
  }

  window.addEventListener('ucEvent', handleUCEvent);
  window.addEventListener('UC_UI_INITIALIZED', handleUCInitialized);

  // If Usercentrics is already initialised, emit current state immediately
  if (win.UC_UI?.isInitialized?.()) {
    readAndEmit();
    callbacks.onReady?.();
  }

  return () => {
    window.removeEventListener('ucEvent', handleUCEvent);
    window.removeEventListener('UC_UI_INITIALIZED', handleUCInitialized);
  };
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

/**
 * Start the appropriate CMP listener for the given mode.
 * 'builtin' mode has no external CMP — returns a no-op cleanup.
 *
 * @param mode            The active ConsentMode from ConsentConfig
 * @param callbacks       Callbacks to invoke on consent changes
 * @param categoryMapping User-configured CMP category → Atlas category mapping
 *                        (from CMPConfig.category_mapping). Not needed for Cookiebot.
 * @returns Cleanup function — call to remove all event listeners
 */
export function startCMPListener(
  mode: ConsentMode,
  callbacks: CMPListenerCallbacks,
  categoryMapping: Record<string, ConsentCategory> = {},
): () => void {
  switch (mode) {
    case 'onetrust':
      return startOneTrustListener(callbacks, categoryMapping);
    case 'cookiebot':
      return startCookiebotListener(callbacks);
    case 'usercentrics':
      return startUsercentricsListener(callbacks, categoryMapping);
    default:
      // 'builtin' — Atlas manages consent internally; no external CMP listener needed
      return () => undefined;
  }
}

// ── Detection helpers (used by CMPIntegration UI) ─────────────────────────────

/**
 * Check whether the CMP for a given mode is currently loaded on the page.
 * Returns true only if the CMP's global object is detected.
 */
export function detectCMPOnPage(mode: ConsentMode): boolean {
  if (typeof window === 'undefined') return false;
  try {
    switch (mode) {
      case 'onetrust':
        return Boolean((window as Window & OneTrustWindow).OneTrust);
      case 'cookiebot':
        return Boolean((window as Window & CookiebotWindow).Cookiebot);
      case 'usercentrics':
        return Boolean((window as Window & UCWindow).UC_UI);
      default:
        return false;
    }
  } catch {
    return false;
  }
}

// Re-export for convenience
export type { ConsentDecisions, ConsentMode, ConsentCategory, ConsentState };
