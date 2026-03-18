/**
 * CAPI Module — Zustand Store
 *
 * Manages:
 *   - List of configured CAPI providers for the current user
 *   - SetupWizard state (current step, draft config)
 *   - Selected provider for the dashboard view
 */

import { create } from 'zustand';
import type {
  CAPIProviderConfig,
  CAPIProvider,
  EventMapping,
  IdentifierConfig,
  DedupConfig,
  ProviderCredentials,
  ProviderDashboardResponse,
} from '@/types/capi';

// ── Wizard draft ──────────────────────────────────────────────────────────────

export interface WizardDraft {
  provider: CAPIProvider;
  credentials: Partial<ProviderCredentials>;
  event_mapping: EventMapping[];
  identifier_config: IdentifierConfig;
  dedup_config: DedupConfig;
  test_event_code: string;
  project_id: string;
}

const DEFAULT_DRAFT: WizardDraft = {
  provider: 'meta',
  credentials: {},
  event_mapping: [],
  identifier_config: {
    enabled_identifiers: ['email', 'phone', 'fn', 'ln', 'fbc', 'fbp', 'gclid', 'wbraid', 'gbraid'],
    source_mapping: {},
  },
  dedup_config: {
    enabled: true,
    event_id_field: 'event_id',
    dedup_window_minutes: 2880,
  },
  test_event_code: '',
  project_id: '',
};

// ── Store ─────────────────────────────────────────────────────────────────────

interface CAPIStore {
  // ── Provider list ─────────────────────────────────────────────────────────
  providers: CAPIProviderConfig[];
  providersLoading: boolean;
  providersError: string | null;
  setProviders: (providers: CAPIProviderConfig[]) => void;
  setProvidersLoading: (loading: boolean) => void;
  setProvidersError: (error: string | null) => void;
  removeProvider: (id: string) => void;

  // ── Setup Wizard ──────────────────────────────────────────────────────────
  wizardOpen: boolean;
  wizardStep: 1 | 2 | 3 | 4 | 5;
  wizardDraft: WizardDraft;
  wizardProviderId: string | null;   // set after createProvider succeeds
  wizardSaving: boolean;
  wizardError: string | null;
  openWizard: (provider?: CAPIProvider) => void;
  closeWizard: () => void;
  setWizardStep: (step: 1 | 2 | 3 | 4 | 5) => void;
  setWizardDraft: (patch: Partial<WizardDraft>) => void;
  setWizardProviderId: (id: string) => void;
  setWizardSaving: (saving: boolean) => void;
  setWizardError: (error: string | null) => void;

  // ── Dashboard ─────────────────────────────────────────────────────────────
  selectedProviderId: string | null;
  dashboard: ProviderDashboardResponse | null;
  dashboardLoading: boolean;
  selectProvider: (id: string | null) => void;
  setDashboard: (dashboard: ProviderDashboardResponse) => void;
  setDashboardLoading: (loading: boolean) => void;

  // ── Reset ─────────────────────────────────────────────────────────────────
  reset: () => void;
}

const initialState = {
  providers: [],
  providersLoading: false,
  providersError: null,
  wizardOpen: false,
  wizardStep: 1 as const,
  wizardDraft: DEFAULT_DRAFT,
  wizardProviderId: null,
  wizardSaving: false,
  wizardError: null,
  selectedProviderId: null,
  dashboard: null,
  dashboardLoading: false,
};

export const useCAPIStore = create<CAPIStore>((set) => ({
  ...initialState,

  setProviders: (providers) => set({ providers }),
  setProvidersLoading: (providersLoading) => set({ providersLoading }),
  setProvidersError: (providersError) => set({ providersError }),
  removeProvider: (id) => set(s => ({ providers: s.providers.filter(p => p.id !== id) })),

  openWizard: (provider = 'meta') =>
    set({ wizardOpen: true, wizardStep: 1, wizardDraft: { ...DEFAULT_DRAFT, provider }, wizardProviderId: null, wizardError: null }),
  closeWizard: () => set({ wizardOpen: false }),
  setWizardStep: (wizardStep) => set({ wizardStep }),
  setWizardDraft: (patch) => set(s => ({ wizardDraft: { ...s.wizardDraft, ...patch } })),
  setWizardProviderId: (wizardProviderId) => set({ wizardProviderId }),
  setWizardSaving: (wizardSaving) => set({ wizardSaving }),
  setWizardError: (wizardError) => set({ wizardError }),

  selectProvider: (selectedProviderId) => set({ selectedProviderId, dashboard: null }),
  setDashboard: (dashboard) => set({ dashboard }),
  setDashboardLoading: (dashboardLoading) => set({ dashboardLoading }),

  reset: () => set(initialState),
}));
