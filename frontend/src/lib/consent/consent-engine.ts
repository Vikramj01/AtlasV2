/**
 * Consent Engine — Core State Management
 *
 * Handles:
 *   1. Loading the active consent record from the API (or localStorage fallback)
 *   2. Persisting new consent decisions via POST /api/consent/record
 *   3. Deriving GCM state and pushing it to gtag
 *   4. Exposing helpers used by the consentStore and the banner snippet
 *
 * This module is framework-agnostic (no React imports).
 * All React state lives in consentStore.ts which calls these functions.
 */

import type {
  ConsentConfig,
  ConsentDecisions,
  ConsentRecord,
  ConsentState,
  ConsentCategory,
  GCMState,
  RecordConsentRequest,
  RecordConsentResponse,
  GetConsentResponse,
} from '@/types/consent';
import { buildGCMState, pushGCMUpdate, pushGCMDefault } from './gcm-mapper';

// ── Storage key ────────────────────────────────────────────────────────────────

const LOCAL_STORAGE_KEY = 'atlas_consent';

// ── Defaults ──────────────────────────────────────────────────────────────────

/** Build the initial decision map from the config (respecting required + defaults). */
export function buildDefaultDecisions(config: ConsentConfig): ConsentDecisions {
  return Object.fromEntries(
    config.categories.map((cat) => [cat.id, cat.required ? 'granted' : cat.default_state]),
  ) as ConsentDecisions;
}

/** All categories granted. */
export function buildGrantAllDecisions(config: ConsentConfig): ConsentDecisions {
  return Object.fromEntries(
    config.categories.map((cat) => [cat.id, 'granted' as ConsentState]),
  ) as ConsentDecisions;
}

/** Only required categories granted; everything else denied. */
export function buildRejectAllDecisions(config: ConsentConfig): ConsentDecisions {
  return Object.fromEntries(
    config.categories.map((cat) => [
      cat.id,
      cat.required ? ('granted' as ConsentState) : ('denied' as ConsentState),
    ]),
  ) as ConsentDecisions;
}

// ── Consent ID generation ─────────────────────────────────────────────────────

/**
 * Generate a UUID-style consent ID to associate with this specific decision.
 * Uses crypto.randomUUID() where available, with a fallback.
 */
export function generateConsentId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for environments without randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ── Visitor ID ────────────────────────────────────────────────────────────────

/**
 * Get or create a stable anonymous visitor ID stored in localStorage.
 * Falls back to a session-only ID if localStorage is unavailable.
 */
export function getOrCreateVisitorId(): string {
  const key = 'atlas_vid';
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const id = generateConsentId();
    localStorage.setItem(key, id);
    return id;
  } catch {
    return generateConsentId();
  }
}

// ── Local persistence ─────────────────────────────────────────────────────────

interface LocalConsentSnapshot {
  decisions: ConsentDecisions;
  gcm_state: GCMState;
  expires_at: string;
  project_id: string;
}

export function saveConsentLocally(
  projectId: string,
  decisions: ConsentDecisions,
  gcmState: GCMState,
  expiresAt: string,
): void {
  try {
    const snapshot: LocalConsentSnapshot = {
      decisions,
      gcm_state: gcmState,
      expires_at: expiresAt,
      project_id: projectId,
    };
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // localStorage unavailable — silent fail
  }
}

export function loadConsentLocally(projectId: string): LocalConsentSnapshot | null {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const snapshot = JSON.parse(raw) as LocalConsentSnapshot;
    if (snapshot.project_id !== projectId) return null;
    if (new Date(snapshot.expires_at) < new Date()) {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
      return null;
    }
    return snapshot;
  } catch {
    return null;
  }
}

// ── API calls ─────────────────────────────────────────────────────────────────

const API_BASE = typeof import.meta !== 'undefined'
  ? (import.meta.env?.VITE_API_URL ?? '')
  : '';

/**
 * Record consent decisions via POST /api/consent/record.
 * No auth token required — this is called from the banner (end-user browser).
 */
export async function recordConsent(
  config: ConsentConfig,
  decisions: ConsentDecisions,
  visitorId: string,
): Promise<RecordConsentResponse> {
  const consentId = generateConsentId();
  const gcmState = config.gcm_enabled
    ? buildGCMState(decisions, config.gcm_mapping)
    : null;

  const payload: RecordConsentRequest = {
    project_id: config.project_id,
    visitor_id: visitorId,
    consent_id: consentId,
    decisions,
    source: 'builtin',
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
  };

  const res = await fetch(`${API_BASE}/api/consent/record`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message ?? `Consent record failed: ${res.status}`);
  }

  const response = await res.json() as RecordConsentResponse;

  // Persist locally and push GCM update immediately
  const effectiveGCM = response.gcm_state ?? gcmState ?? {};
  saveConsentLocally(config.project_id, decisions, effectiveGCM, response.expires_at);
  pushGCMUpdate(effectiveGCM);

  return response;
}

/**
 * Fetch latest consent state for a visitor via GET /api/consent/:projectId/:visitorId.
 * Requires an auth token (called from the Atlas dashboard, not from the banner).
 */
export async function fetchConsentState(
  projectId: string,
  visitorId: string,
  authToken: string,
): Promise<GetConsentResponse | null> {
  const res = await fetch(`${API_BASE}/api/consent/${projectId}/${visitorId}`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to fetch consent state: ${res.status}`);
  return res.json() as Promise<GetConsentResponse>;
}

// ── Initialisation helper ─────────────────────────────────────────────────────

/**
 * Initialise the consent engine on page load.
 *
 * 1. If a valid local snapshot exists → push GCM default and return it.
 * 2. Otherwise → push all-denied GCM default (privacy-first).
 *
 * Call this as early as possible in the page lifecycle, before any ad tags load.
 */
export function initConsentEngine(
  projectId: string,
  config: ConsentConfig | null,
): { decisions: ConsentDecisions | null; gcm_state: GCMState; hasPriorConsent: boolean } {
  const allDenied: GCMState = {
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    personalization_storage: 'denied',
    functionality_storage: 'granted',
    security_storage: 'granted',
  };

  const local = loadConsentLocally(projectId);
  if (local) {
    pushGCMDefault(local.gcm_state);
    return { decisions: local.decisions, gcm_state: local.gcm_state, hasPriorConsent: true };
  }

  // No prior consent — set restrictive defaults
  const defaultGCM = config
    ? buildGCMState(buildDefaultDecisions(config), config.gcm_mapping)
    : allDenied;

  pushGCMDefault(defaultGCM);
  return { decisions: null, gcm_state: defaultGCM, hasPriorConsent: false };
}

// ── Utility ───────────────────────────────────────────────────────────────────

/** Check whether a specific category is currently granted. */
export function isCategoryGranted(
  decisions: ConsentDecisions | null,
  category: ConsentCategory,
): boolean {
  if (!decisions) return false;
  return decisions[category] === 'granted';
}

/** True if the visitor has made any active consent decision. */
export function hasActiveConsent(record: ConsentRecord | null): boolean {
  if (!record) return false;
  return new Date(record.expires_at) > new Date();
}
