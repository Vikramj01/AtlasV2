/**
 * Consent Hub — Zustand Store
 *
 * Manages:
 *   - The active ConsentConfig for the selected project
 *   - The current visitor's consent decisions
 *   - Loading / saving state for the ConsentSettings page
 */

import { create } from 'zustand';
import type {
  ConsentConfig,
  ConsentDecisions,
  GCMState,
  ConsentAnalyticsResponse,
} from '@/types/consent';

interface ConsentStore {
  // ── Config ────────────────────────────────────────────────────────────────
  config: ConsentConfig | null;
  configLoading: boolean;
  configError: string | null;
  setConfig: (config: ConsentConfig) => void;
  setConfigLoading: (loading: boolean) => void;
  setConfigError: (error: string | null) => void;

  // ── Visitor consent state ─────────────────────────────────────────────────
  decisions: ConsentDecisions | null;
  gcmState: GCMState | null;
  hasPriorConsent: boolean;
  setDecisions: (decisions: ConsentDecisions, gcmState: GCMState) => void;
  setHasPriorConsent: (value: boolean) => void;

  // ── Analytics ─────────────────────────────────────────────────────────────
  analytics: ConsentAnalyticsResponse | null;
  analyticsLoading: boolean;
  setAnalytics: (analytics: ConsentAnalyticsResponse) => void;
  setAnalyticsLoading: (loading: boolean) => void;

  // ── UI state ──────────────────────────────────────────────────────────────
  activeTab: 'settings' | 'banner' | 'analytics';
  setActiveTab: (tab: 'settings' | 'banner' | 'analytics') => void;

  // ── Reset ─────────────────────────────────────────────────────────────────
  reset: () => void;
}

const initialState = {
  config: null,
  configLoading: false,
  configError: null,
  decisions: null,
  gcmState: null,
  hasPriorConsent: false,
  analytics: null,
  analyticsLoading: false,
  activeTab: 'settings' as const,
};

export const useConsentStore = create<ConsentStore>((set) => ({
  ...initialState,

  setConfig: (config) => set({ config, configError: null }),
  setConfigLoading: (configLoading) => set({ configLoading }),
  setConfigError: (configError) => set({ configError }),

  setDecisions: (decisions, gcmState) => set({ decisions, gcmState }),
  setHasPriorConsent: (hasPriorConsent) => set({ hasPriorConsent }),

  setAnalytics: (analytics) => set({ analytics }),
  setAnalyticsLoading: (analyticsLoading) => set({ analyticsLoading }),

  setActiveTab: (activeTab) => set({ activeTab }),

  reset: () => set(initialState),
}));
