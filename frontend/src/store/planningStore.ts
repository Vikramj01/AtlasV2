import { create } from 'zustand';
import type {
  PlanningSession,
  PlanningPage,
  PlanningRecommendation,
  PlanningOutput,
  CreateSessionInput,
  SiteDetection,
} from '@/types/planning';
import { planningApi } from '@/lib/api/planningApi';

// ── Wizard step definitions ────────────────────────────────────────────────────

export type PlanningStep = 1 | 2 | 3 | 4 | 5 | 6 | 7;

// ── Store shape ────────────────────────────────────────────────────────────────

interface PlanningStore {
  // Wizard navigation
  currentStep: PlanningStep;

  // Draft form data (Steps 1–2, before session is created)
  draftSetup: Partial<CreateSessionInput>;

  // Live session state (populated after POST /sessions)
  currentSession: PlanningSession | null;
  pages: PlanningPage[];
  recommendations: PlanningRecommendation[];
  outputs: PlanningOutput[];

  // Site detection (Step 1)
  siteDetection: SiteDetection | null;
  detectionLoading: boolean;
  detectionError: string | null;

  // Polling / loading
  isLoading: boolean;
  error: string | null;

  // ── Actions ──────────────────────────────────────────────────────────────────

  setStep: (step: PlanningStep) => void;
  nextStep: () => void;
  prevStep: () => void;

  updateDraftSetup: (partial: Partial<CreateSessionInput>) => void;
  clearDraft: () => void;

  setCurrentSession: (session: PlanningSession) => void;
  updateSessionStatus: (status: PlanningSession['status'], error?: string | null) => void;

  setPages: (pages: PlanningPage[]) => void;
  updatePage: (id: string, partial: Partial<PlanningPage>) => void;

  setRecommendations: (recs: PlanningRecommendation[]) => void;
  updateRecommendation: (id: string, partial: Partial<PlanningRecommendation>) => void;

  setOutputs: (outputs: PlanningOutput[]) => void;

  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  runDetection: (url: string) => Promise<void>;
  clearDetection: () => void;

  reset: () => void;
}

// ── Initial state ──────────────────────────────────────────────────────────────

const initialState = {
  currentStep: 1 as PlanningStep,
  draftSetup: {},
  currentSession: null,
  pages: [],
  recommendations: [],
  outputs: [],
  siteDetection: null,
  detectionLoading: false,
  detectionError: null,
  isLoading: false,
  error: null,
};

// ── Store ──────────────────────────────────────────────────────────────────────

export const usePlanningStore = create<PlanningStore>((set) => ({
  ...initialState,

  setStep: (step) => set({ currentStep: step }),

  nextStep: () =>
    set((state) => ({
      currentStep: Math.min(state.currentStep + 1, 7) as PlanningStep,
    })),

  prevStep: () =>
    set((state) => ({
      currentStep: Math.max(state.currentStep - 1, 1) as PlanningStep,
    })),

  updateDraftSetup: (partial) =>
    set((state) => ({ draftSetup: { ...state.draftSetup, ...partial } })),

  clearDraft: () => set({ draftSetup: {} }),

  setCurrentSession: (session) => set({ currentSession: session }),

  updateSessionStatus: (status, error = null) =>
    set((state) =>
      state.currentSession
        ? {
            currentSession: { ...state.currentSession, status },
            error,
          }
        : state
    ),

  setPages: (pages) => set({ pages }),

  updatePage: (id, partial) =>
    set((state) => ({
      pages: state.pages.map((p) => (p.id === id ? { ...p, ...partial } : p)),
    })),

  setRecommendations: (recommendations) => set({ recommendations }),

  updateRecommendation: (id, partial) =>
    set((state) => ({
      recommendations: state.recommendations.map((r) =>
        r.id === id ? { ...r, ...partial } : r
      ),
    })),

  setOutputs: (outputs) => set({ outputs }),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error }),

  runDetection: async (url) => {
    set({ detectionLoading: true, detectionError: null, siteDetection: null });
    try {
      const detection = await planningApi.detectSite(url);
      set({ siteDetection: detection, detectionLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Detection failed';
      set({ detectionError: message, detectionLoading: false });
    }
  },

  clearDetection: () => set({ siteDetection: null, detectionError: null, detectionLoading: false }),

  reset: () => set(initialState),
}));
