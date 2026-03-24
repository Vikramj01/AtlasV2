/**
 * CMP Listener Bridges — OneTrust, Cookiebot, Usercentrics
 *
 * Translates each CMP's consent change events into Atlas ConsentDecisions.
 * Runs in the browser (WalkerOS integration layer).
 *
 * Each listener returns a cleanup function that removes all registered event
 * listeners. Never throws if window CMP globals are undefined.
 */

import type { ConsentCategory, ConsentDecisions, ConsentMode, ConsentState } from '@/types/consent';

// ── Callback interface ─────────────────────────────────────────────────────────

export interface CMPListenerCallbacks {
  onConsentChange: (decisions: ConsentDecisions, source: ConsentMode) => void;
  onReady?: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
 * Given a set of granted Atlas category keys and all available categories,
 * returns a full ConsentDecisions map (denied for anything not in granted set).
 */
function buildDecisions(
  grantedCategories: Set<ConsentCategory>,
  alwaysGranted: ConsentCategory[] = [],
): ConsentDecisions {
  const decisions = buildDeniedDecisions();
  for (const cat of ALL_CATEGORIES) {
    if (grantedCategories.has(cat) || alwaysGranted.includes(cat)) {
      decisions[cat] = 'granted';
    }
  }
  return decisions;
}

/**
 * Maps an arbitrary CMP key to an Atlas ConsentCategory via category_mapping.
 * Returns null if no mapping is found.
 */
function mapToAtlasCategory(
  cmpKey: string,
  categoryMapping: Record<string, ConsentCategory>,
): ConsentCategory | null {
  return categoryMapping[cmpKey] ?? null;
}

// ── OneTrust ──────────────────────────────────────────────────────────────────

interface OneTrustWindow {
  OneTrust?: {
    GetDomainData?: () => {
      Groups?: Array<{ CustomGroupId: string; Status: string }>;
    };
  };
}

/**
 * Parses OneTrust active group IDs and maps them to Atlas categories.
 * OneTrust uses group IDs like "C0002", "C0003", "C0004".
 * C0001 (Strictly Necessary) is always active.
 */
function parseOneTrustGroups(
  activeGroupIds: string[],
  categoryMapping: Record<string, ConsentCategory>,
): ConsentDecisions {
  const granted = new Set<ConsentCategory>();
  for (const groupId of activeGroupIds) {
    const atlasCategory = mapToAtlasCategory(groupId, categoryMapping);
    if (atlasCategory) {
      granted.add(atlasCategory);
    }
  }
  return buildDecisions(granted, ['functional']);
}

/**
 * Reads current OneTrust consent from GetDomainData API.
 */
function readOneTrustCurrent(
  categoryMapping: Record<string, ConsentCategory>,
): ConsentDecisions | null {
  try {
    const w = window as OneTrustWindow;
    const domainData = w.OneTrust?.GetDomainData?.();
    if (!domainData?.Groups) return null;

    const activeIds = domainData.Groups
      .filter((g) => g.Status === 'always' || g.Status === 'active')
      .map((g) => g.CustomGroupId);

    return parseOneTrustGroups(activeIds, categoryMapping);
  } catch {
    return null;
  }
}

export function startOneTrustListener(
  callbacks: CMPListenerCallbacks,
  categoryMapping: Record<string, ConsentCategory> = {},
): () => void {
  const handlers: Array<{ event: string; fn: EventListener }> = [];

  function register(event: string, fn: EventListener) {
    window.addEventListener(event, fn);
    handlers.push({ event, fn });
  }

  function cleanup() {
    for (const { event, fn } of handlers) {
      window.removeEventListener(event, fn);
    }
  }

  // OneTrust newer API: fires with array of active group IDs
  const onGroupsUpdated: EventListener = (e) => {
    try {
      const detail = (e as CustomEvent<string[]>).detail;
      const activeIds = Array.isArray(detail) ? detail : [];
      const decisions = parseOneTrustGroups(activeIds, categoryMapping);
      callbacks.onConsentChange(decisions, 'onetrust');
    } catch {
      // defensive — never throw
    }
  };

  // OneTrust legacy API
  const onConsentChanged: EventListener = () => {
    try {
      const decisions = readOneTrustCurrent(categoryMapping);
      if (decisions) {
        callbacks.onConsentChange(decisions, 'onetrust');
      }
    } catch {
      // defensive
    }
  };

  register('OneTrustGroupsUpdated', onGroupsUpdated);
  register('consent.onetrust', onConsentChanged);

  // Read initial state if OneTrust is already loaded
  try {
    const initial = readOneTrustCurrent(categoryMapping);
    if (initial) {
      callbacks.onConsentChange(initial, 'onetrust');
      callbacks.onReady?.();
    }
  } catch {
    // defensive
  }

  return cleanup;
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
    consent: CookiebotConsent;
  };
}

/**
 * Cookiebot has a fixed category structure — map directly to Atlas categories.
 * The category_mapping from CMPConfig can override, but sensible defaults apply:
 *   statistics → analytics
 *   marketing  → marketing
 *   preferences → personalisation
 *   necessary  → functional (always granted)
 */
const COOKIEBOT_DEFAULT_MAPPING: Record<string, ConsentCategory> = {
  statistics: 'analytics',
  marketing: 'marketing',
  preferences: 'personalisation',
  necessary: 'functional',
};

function readCookiebotConsent(
  categoryMapping: Record<string, ConsentCategory>,
): ConsentDecisions | null {
  try {
    const w = window as CookiebotWindow;
    const consent = w.Cookiebot?.consent;
    if (!consent) return null;

    const effectiveMapping = { ...COOKIEBOT_DEFAULT_MAPPING, ...categoryMapping };
    const granted = new Set<ConsentCategory>();

    const consentMap: Record<string, boolean> = {
      necessary: consent.necessary,
      preferences: consent.preferences,
      statistics: consent.statistics,
      marketing: consent.marketing,
    };

    for (const [cbKey, isGranted] of Object.entries(consentMap)) {
      if (isGranted) {
        const atlasCategory = mapToAtlasCategory(cbKey, effectiveMapping);
        if (atlasCategory) {
          granted.add(atlasCategory);
        }
      }
    }

    return buildDecisions(granted, ['functional']);
  } catch {
    return null;
  }
}

export function startCookiebotListener(
  callbacks: CMPListenerCallbacks,
  categoryMapping: Record<string, ConsentCategory> = {},
): () => void {
  const handlers: Array<{ event: string; fn: EventListener }> = [];

  function register(event: string, fn: EventListener) {
    window.addEventListener(event, fn);
    handlers.push({ event, fn });
  }

  function cleanup() {
    for (const { event, fn } of handlers) {
      window.removeEventListener(event, fn);
    }
  }

  function emitCurrentConsent() {
    try {
      const decisions = readCookiebotConsent(categoryMapping);
      if (decisions) {
        callbacks.onConsentChange(decisions, 'cookiebot');
      }
    } catch {
      // defensive
    }
  }

  const onReady: EventListener = () => {
    try {
      callbacks.onReady?.();
      emitCurrentConsent();
    } catch {
      // defensive
    }
  };

  const onChange: EventListener = () => {
    emitCurrentConsent();
  };

  register('CookiebotOnDialogDisplay', onReady);
  register('CookiebotOnConsentReady', onChange);
  register('CookiebotOnAccept', onChange);
  register('CookiebotOnDecline', onChange);

  // Read initial state if Cookiebot is already loaded
  try {
    const initial = readCookiebotConsent(categoryMapping);
    if (initial) {
      callbacks.onConsentChange(initial, 'cookiebot');
    }
  } catch {
    // defensive
  }

  return cleanup;
}

// ── Usercentrics ──────────────────────────────────────────────────────────────

interface UCService {
  consent?: { status: boolean };
  templateId?: string;
  name?: string;
}

interface UCWindow {
  UC_UI?: {
    getServicesBaseInfo?: () => UCService[];
  };
}

type UCEventDetail =
  | { type: 'CONSENT_ACCEPTED' }
  | { type: 'CONSENT_DENIED' }
  | { type: 'UI_INITIALIZED' };

/**
 * Reads current Usercentrics consent via UC_UI.getServicesBaseInfo().
 * Maps service templateId or name to Atlas categories via category_mapping.
 */
function readUsercentricsConsent(
  categoryMapping: Record<string, ConsentCategory>,
): ConsentDecisions | null {
  try {
    const w = window as UCWindow;
    const services = w.UC_UI?.getServicesBaseInfo?.();
    if (!services || !Array.isArray(services)) return null;

    const granted = new Set<ConsentCategory>();

    for (const service of services) {
      if (!service.consent?.status) continue;

      // Try templateId first, then name
      const keys: string[] = [];
      if (service.templateId) keys.push(service.templateId);
      if (service.name) keys.push(service.name);

      for (const key of keys) {
        const atlasCategory = mapToAtlasCategory(key, categoryMapping);
        if (atlasCategory) {
          granted.add(atlasCategory);
          break;
        }
      }
    }

    return buildDecisions(granted);
  } catch {
    return null;
  }
}

export function startUsercentricsListener(
  callbacks: CMPListenerCallbacks,
  categoryMapping: Record<string, ConsentCategory> = {},
): () => void {
  const handlers: Array<{ event: string; fn: EventListener }> = [];

  function register(event: string, fn: EventListener) {
    window.addEventListener(event, fn);
    handlers.push({ event, fn });
  }

  function cleanup() {
    for (const { event, fn } of handlers) {
      window.removeEventListener(event, fn);
    }
  }

  function emitCurrentConsent() {
    try {
      const decisions = readUsercentricsConsent(categoryMapping);
      if (decisions) {
        callbacks.onConsentChange(decisions, 'usercentrics');
      }
    } catch {
      // defensive
    }
  }

  const onUCEvent: EventListener = (e) => {
    try {
      const detail = (e as CustomEvent<UCEventDetail>).detail;
      if (!detail?.type) return;

      if (detail.type === 'UI_INITIALIZED') {
        callbacks.onReady?.();
        emitCurrentConsent();
      } else if (detail.type === 'CONSENT_ACCEPTED' || detail.type === 'CONSENT_DENIED') {
        emitCurrentConsent();
      }
    } catch {
      // defensive
    }
  };

  const onUIInitialized: EventListener = () => {
    try {
      callbacks.onReady?.();
      emitCurrentConsent();
    } catch {
      // defensive
    }
  };

  register('ucEvent', onUCEvent);
  register('UC_UI_INITIALIZED', onUIInitialized);

  // Read initial state if UC_UI is already loaded
  try {
    const initial = readUsercentricsConsent(categoryMapping);
    if (initial) {
      callbacks.onConsentChange(initial, 'usercentrics');
    }
  } catch {
    // defensive
  }

  return cleanup;
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

/**
 * Start the appropriate CMP listener for the given mode.
 * For 'builtin', does nothing and returns a no-op cleanup.
 *
 * The categoryMapping from CMPConfig is forwarded to the listener so CMP
 * category IDs are translated into Atlas categories per user configuration.
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
      return startCookiebotListener(callbacks, categoryMapping);
    case 'usercentrics':
      return startUsercentricsListener(callbacks, categoryMapping);
    case 'builtin':
    default:
      return () => undefined;
  }
}

// ── Type guards (exported for consumers) ──────────────────────────────────────

export function isGranted(state: ConsentState): boolean {
  return state === 'granted';
}
