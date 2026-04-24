import { create } from 'zustand';
import type {
  StrategyBriefRecord,
  StrategyBriefWithObjectives,
  StrategyObjective,
} from '@/types/strategy';
import { strategyApi } from '@/lib/api/strategyApi';

interface StrategyStore {
  // Brief list
  briefs: StrategyBriefRecord[];
  briefsLoading: boolean;
  briefsError: string | null;

  // Active brief (with objectives)
  activeBrief: StrategyBriefWithObjectives | null;
  activeBriefLoading: boolean;
  activeBriefError: string | null;

  // Per-objective loading flags (keyed by objective id)
  objectiveLoading: Record<string, boolean>;

  // Actions — briefs
  fetchBriefs: () => Promise<void>;
  fetchBrief: (id: string) => Promise<void>;
  createBrief: (input: { brief_name?: string; client_id?: string; project_id?: string }) => Promise<StrategyBriefRecord>;
  deleteBrief: (id: string) => Promise<void>;
  setActiveBrief: (brief: StrategyBriefWithObjectives | null) => void;

  // Actions — objectives
  createObjective: (input: {
    brief_id: string;
    name: string;
    description?: string;
    platforms?: string[];
    current_event?: string;
    outcome_timing_days?: number;
  }) => Promise<{ objective: StrategyObjective; softCapMessage: string | null }>;
  updateObjective: (id: string, input: {
    name?: string;
    description?: string;
    platforms?: string[];
    current_event?: string;
    outcome_timing_days?: number;
  }) => Promise<StrategyObjective>;
  deleteObjective: (id: string) => Promise<void>;
  evaluateObjective: (id: string) => Promise<StrategyObjective>;
  lockObjective: (id: string) => Promise<StrategyObjective>;

  reset: () => void;
}

const initialState = {
  briefs: [],
  briefsLoading: false,
  briefsError: null,
  activeBrief: null,
  activeBriefLoading: false,
  activeBriefError: null,
  objectiveLoading: {},
};

export const useStrategyStore = create<StrategyStore>((set, get) => ({
  ...initialState,

  // ── Briefs ──────────────────────────────────────────────────────────────────

  fetchBriefs: async () => {
    set({ briefsLoading: true, briefsError: null });
    try {
      const { data } = await strategyApi.listBriefs();
      set({ briefs: data, briefsLoading: false });
    } catch (err) {
      set({ briefsError: err instanceof Error ? err.message : 'Failed to load briefs', briefsLoading: false });
    }
  },

  fetchBrief: async (id: string) => {
    set({ activeBriefLoading: true, activeBriefError: null });
    try {
      const { data } = await strategyApi.getBrief(id);
      set({ activeBrief: data, activeBriefLoading: false });
    } catch (err) {
      set({ activeBriefError: err instanceof Error ? err.message : 'Failed to load brief', activeBriefLoading: false });
    }
  },

  createBrief: async (input) => {
    const { data } = await strategyApi.createBrief(input);
    set((s) => ({ briefs: [data, ...s.briefs] }));
    return data;
  },

  deleteBrief: async (id: string) => {
    await strategyApi.deleteBrief(id);
    set((s) => ({
      briefs: s.briefs.filter((b) => b.id !== id),
      activeBrief: s.activeBrief?.id === id ? null : s.activeBrief,
    }));
  },

  setActiveBrief: (brief) => set({ activeBrief: brief }),

  // ── Objectives ──────────────────────────────────────────────────────────────

  createObjective: async (input) => {
    const { data: objective, message } = await strategyApi.createObjective(input);
    set((s) => {
      if (!s.activeBrief || s.activeBrief.id !== input.brief_id) return {};
      return { activeBrief: { ...s.activeBrief, objectives: [...s.activeBrief.objectives, objective] } };
    });
    return { objective, softCapMessage: message };
  },

  updateObjective: async (id, input) => {
    set((s) => ({ objectiveLoading: { ...s.objectiveLoading, [id]: true } }));
    try {
      const { data } = await strategyApi.updateObjective(id, input);
      set((s) => ({
        objectiveLoading: { ...s.objectiveLoading, [id]: false },
        activeBrief: s.activeBrief
          ? { ...s.activeBrief, objectives: s.activeBrief.objectives.map((o) => o.id === id ? data : o) }
          : null,
      }));
      return data;
    } catch (err) {
      set((s) => ({ objectiveLoading: { ...s.objectiveLoading, [id]: false } }));
      throw err;
    }
  },

  deleteObjective: async (id) => {
    await strategyApi.deleteObjective(id);
    set((s) => ({
      activeBrief: s.activeBrief
        ? { ...s.activeBrief, objectives: s.activeBrief.objectives.filter((o) => o.id !== id) }
        : null,
    }));
  },

  evaluateObjective: async (id) => {
    set((s) => ({ objectiveLoading: { ...s.objectiveLoading, [id]: true } }));
    try {
      const { data } = await strategyApi.evaluateObjective(id);
      const updatedObjective = data.objective;
      set((s) => ({
        objectiveLoading: { ...s.objectiveLoading, [id]: false },
        activeBrief: s.activeBrief
          ? { ...s.activeBrief, objectives: s.activeBrief.objectives.map((o) => o.id === id ? updatedObjective : o) }
          : null,
      }));
      return updatedObjective;
    } catch (err) {
      set((s) => ({ objectiveLoading: { ...s.objectiveLoading, [id]: false } }));
      throw err;
    }
  },

  lockObjective: async (id) => {
    set((s) => ({ objectiveLoading: { ...s.objectiveLoading, [id]: true } }));
    try {
      const { data } = await strategyApi.lockObjective(id);
      set((s) => ({
        objectiveLoading: { ...s.objectiveLoading, [id]: false },
        activeBrief: s.activeBrief
          ? { ...s.activeBrief, objectives: s.activeBrief.objectives.map((o) => o.id === id ? data : o) }
          : null,
      }));
      return data;
    } catch (err) {
      set((s) => ({ objectiveLoading: { ...s.objectiveLoading, [id]: false } }));
      throw err;
    }
  },

  reset: () => set(initialState),
}));
