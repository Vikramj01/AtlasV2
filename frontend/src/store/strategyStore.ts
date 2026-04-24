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
  createBrief: (input: { mode?: 'single' | 'multi'; brief_name?: string; client_id?: string; project_id?: string }) => Promise<StrategyBriefRecord>;
  lockBrief: (id: string) => Promise<StrategyBriefRecord>;
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

export const useStrategyStore = create<StrategyStore>((set) => ({
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
    set((s: StrategyStore) => ({ briefs: [data, ...s.briefs] }));
    return data;
  },

  lockBrief: async (id: string) => {
    const { data } = await strategyApi.lockBrief(id);
    set((s: StrategyStore) => ({
      briefs: s.briefs.map((b) => b.id === id ? data : b),
      activeBrief: s.activeBrief?.id === id
        ? { ...s.activeBrief, locked_at: data.locked_at }
        : s.activeBrief,
    }));
    return data;
  },

  deleteBrief: async (id: string) => {
    await strategyApi.deleteBrief(id);
    set((s: StrategyStore) => ({
      briefs: s.briefs.filter((b) => b.id !== id),
      activeBrief: s.activeBrief?.id === id ? null : s.activeBrief,
    }));
  },

  setActiveBrief: (brief) => set({ activeBrief: brief }),

  // ── Objectives ──────────────────────────────────────────────────────────────

  createObjective: async (input) => {
    const { data: objective, message } = await strategyApi.createObjective(input);
    set((s: StrategyStore) => {
      if (!s.activeBrief || s.activeBrief.id !== input.brief_id) return {};
      return { activeBrief: { ...s.activeBrief, objectives: [...s.activeBrief.objectives, objective] } };
    });
    return { objective, softCapMessage: message };
  },

  updateObjective: async (id: string, input) => {
    set((s: StrategyStore) => ({ objectiveLoading: { ...s.objectiveLoading, [id]: true } }));
    try {
      const { data } = await strategyApi.updateObjective(id, input);
      set((s: StrategyStore) => ({
        objectiveLoading: { ...s.objectiveLoading, [id]: false },
        activeBrief: s.activeBrief
          ? { ...s.activeBrief, objectives: s.activeBrief.objectives.map((o: StrategyObjective) => o.id === id ? data : o) }
          : null,
      }));
      return data;
    } catch (err) {
      set((s: StrategyStore) => ({ objectiveLoading: { ...s.objectiveLoading, [id]: false } }));
      throw err;
    }
  },

  deleteObjective: async (id: string) => {
    await strategyApi.deleteObjective(id);
    set((s: StrategyStore) => ({
      activeBrief: s.activeBrief
        ? { ...s.activeBrief, objectives: s.activeBrief.objectives.filter((o: StrategyObjective) => o.id !== id) }
        : null,
    }));
  },

  evaluateObjective: async (id: string) => {
    set((s: StrategyStore) => ({ objectiveLoading: { ...s.objectiveLoading, [id]: true } }));
    try {
      const { data } = await strategyApi.evaluateObjective(id);
      const updatedObjective = data.objective;
      set((s: StrategyStore) => ({
        objectiveLoading: { ...s.objectiveLoading, [id]: false },
        activeBrief: s.activeBrief
          ? { ...s.activeBrief, objectives: s.activeBrief.objectives.map((o: StrategyObjective) => o.id === id ? updatedObjective : o) }
          : null,
      }));
      return updatedObjective;
    } catch (err) {
      set((s: StrategyStore) => ({ objectiveLoading: { ...s.objectiveLoading, [id]: false } }));
      throw err;
    }
  },

  lockObjective: async (id: string) => {
    set((s: StrategyStore) => ({ objectiveLoading: { ...s.objectiveLoading, [id]: true } }));
    try {
      const { data } = await strategyApi.lockObjective(id);
      set((s: StrategyStore) => ({
        objectiveLoading: { ...s.objectiveLoading, [id]: false },
        activeBrief: s.activeBrief
          ? { ...s.activeBrief, objectives: s.activeBrief.objectives.map((o: StrategyObjective) => o.id === id ? data : o) }
          : null,
      }));
      return data;
    } catch (err) {
      set((s: StrategyStore) => ({ objectiveLoading: { ...s.objectiveLoading, [id]: false } }));
      throw err;
    }
  },

  reset: () => set(initialState),
}));
