/**
 * Offline Conversions Module — Zustand Store
 *
 * Manages:
 *   - Current config (null if not yet set up)
 *   - Setup wizard state (step + accumulated draft)
 *   - Active upload (in-progress CSV batch)
 *   - Upload history (cached for the history table)
 *   - Available Google conversion actions (fetched during wizard step 2)
 *   - Loading / error states
 */

import { create } from 'zustand';
import type {
  OfflineConversionConfig,
  OfflineConversionUpload,
  UploadHistoryResponse,
  GoogleConversionAction,
  SetupWizardStep,
  SetupWizardDraft,
  ValidationSummary,
} from '@/types/offline-conversions';
import { DEFAULT_WIZARD_DRAFT } from '@/types/offline-conversions';

// ── Store interface ───────────────────────────────────────────────────────────

interface OfflineConversionsStore {
  // ── Configuration ────────────────────────────────────────────────────────
  config: OfflineConversionConfig | null;
  configLoading: boolean;
  configError: string | null;
  setConfig: (config: OfflineConversionConfig | null) => void;
  setConfigLoading: (loading: boolean) => void;
  setConfigError: (error: string | null) => void;

  // ── Setup Wizard ─────────────────────────────────────────────────────────
  wizardOpen: boolean;
  wizardStep: SetupWizardStep;
  wizardDraft: SetupWizardDraft;
  wizardSaving: boolean;
  wizardError: string | null;
  /** Conversion actions fetched from the Google Ads account in step 2. */
  conversionActions: GoogleConversionAction[];
  conversionActionsLoading: boolean;
  openWizard: () => void;
  closeWizard: () => void;
  setWizardStep: (step: SetupWizardStep) => void;
  setWizardDraft: (patch: Partial<SetupWizardDraft>) => void;
  setWizardSaving: (saving: boolean) => void;
  setWizardError: (error: string | null) => void;
  setConversionActions: (actions: GoogleConversionAction[]) => void;
  setConversionActionsLoading: (loading: boolean) => void;

  // ── Active Upload ─────────────────────────────────────────────────────────
  /** ID of the upload currently in progress (pending → uploading). */
  activeUploadId: string | null;
  activeUpload: OfflineConversionUpload | null;
  activeUploadValidationSummary: ValidationSummary | null;
  uploadLoading: boolean;
  uploadError: string | null;
  setActiveUploadId: (id: string | null) => void;
  setActiveUpload: (upload: OfflineConversionUpload | null) => void;
  setActiveUploadValidationSummary: (summary: ValidationSummary | null) => void;
  setUploadLoading: (loading: boolean) => void;
  setUploadError: (error: string | null) => void;
  clearActiveUpload: () => void;

  // ── Upload History ────────────────────────────────────────────────────────
  history: UploadHistoryResponse | null;
  historyLoading: boolean;
  historyError: string | null;
  setHistory: (history: UploadHistoryResponse) => void;
  setHistoryLoading: (loading: boolean) => void;
  setHistoryError: (error: string | null) => void;

  // ── Reset ─────────────────────────────────────────────────────────────────
  reset: () => void;
}

// ── Initial state ─────────────────────────────────────────────────────────────

const initialState = {
  config: null,
  configLoading: false,
  configError: null,

  wizardOpen: false,
  wizardStep: 1 as SetupWizardStep,
  wizardDraft: DEFAULT_WIZARD_DRAFT,
  wizardSaving: false,
  wizardError: null,
  conversionActions: [],
  conversionActionsLoading: false,

  activeUploadId: null,
  activeUpload: null,
  activeUploadValidationSummary: null,
  uploadLoading: false,
  uploadError: null,

  history: null,
  historyLoading: false,
  historyError: null,
};

// ── Store ─────────────────────────────────────────────────────────────────────

export const useOfflineConversionsStore = create<OfflineConversionsStore>((set) => ({
  ...initialState,

  // Config
  setConfig: (config) => set({ config }),
  setConfigLoading: (configLoading) => set({ configLoading }),
  setConfigError: (configError) => set({ configError }),

  // Wizard
  openWizard: () =>
    set({
      wizardOpen: true,
      wizardStep: 1,
      wizardDraft: DEFAULT_WIZARD_DRAFT,
      wizardSaving: false,
      wizardError: null,
      conversionActions: [],
    }),
  closeWizard: () => set({ wizardOpen: false }),
  setWizardStep: (wizardStep) => set({ wizardStep }),
  setWizardDraft: (patch) => set((s) => ({ wizardDraft: { ...s.wizardDraft, ...patch } })),
  setWizardSaving: (wizardSaving) => set({ wizardSaving }),
  setWizardError: (wizardError) => set({ wizardError }),
  setConversionActions: (conversionActions) => set({ conversionActions }),
  setConversionActionsLoading: (conversionActionsLoading) => set({ conversionActionsLoading }),

  // Active upload
  setActiveUploadId: (activeUploadId) => set({ activeUploadId }),
  setActiveUpload: (activeUpload) => set({ activeUpload }),
  setActiveUploadValidationSummary: (activeUploadValidationSummary) =>
    set({ activeUploadValidationSummary }),
  setUploadLoading: (uploadLoading) => set({ uploadLoading }),
  setUploadError: (uploadError) => set({ uploadError }),
  clearActiveUpload: () =>
    set({
      activeUploadId: null,
      activeUpload: null,
      activeUploadValidationSummary: null,
      uploadLoading: false,
      uploadError: null,
    }),

  // History
  setHistory: (history) => set({ history }),
  setHistoryLoading: (historyLoading) => set({ historyLoading }),
  setHistoryError: (historyError) => set({ historyError }),

  // Reset (e.g. on sign-out)
  reset: () => set(initialState),
}));
