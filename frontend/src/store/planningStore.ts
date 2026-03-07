import { create } from 'zustand';
import type {
  PlanningSession,
  PlanningPage,
  PlanningRecommendation,
  PlanningOutput,
  CreateSessionInput,
} from '@/types/planning';

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

  reset: () => set(initialState),
}));
