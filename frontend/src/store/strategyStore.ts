import { create } from 'zustand';
import type { StrategyBrief, StrategyObjective, ObjectiveCampaign, BriefMode } from '@/types/strategy';
import { strategyApi } from '@/lib/api/strategyApi';
import type {
  CreateBriefInput,
  AddObjectiveInput,
  PatchObjectiveInput,
  AddCampaignInput,
} from '@/lib/api/strategyApi';

// ── Store shape ────────────────────────────────────────────────────────────────

interface StrategyStore {
  currentBrief: StrategyBrief | null;
  selectedObjectiveId: string | null;

  // Per-objective loading flags
  evaluationLoading: Record<string, boolean>;
  lockLoading: Record<string, boolean>;

  // Brief-level loading
  briefLoading: boolean;
  briefLockLoading: boolean;
  error: string | null;

  // ── Actions ──────────────────────────────────────────────────────────────────

  createBrief: (input: CreateBriefInput) => Promise<StrategyBrief>;
  fetchBrief: (briefId: string) => Promise<void>;
  patchBrief: (briefId: string, fields: { brief_name?: string; mode?: BriefMode }) => Promise<void>;
  lockBrief: (briefId: string) => Promise<void>;

  addObjective: (briefId: string, input: AddObjectiveInput) => Promise<{ soft_cap_warning: boolean }>;
  updateObjective: (objectiveId: string, input: PatchObjectiveInput) => Promise<void>;
  removeObjective: (objectiveId: string) => Promise<void>;
  evaluateObjective: (objectiveId: string, businessType: string) => Promise<void>;
  lockObjective: (objectiveId: string) => Promise<void>;

  addCampaign: (objectiveId: string, input: AddCampaignInput) => Promise<void>;
  removeCampaign: (campaignId: string, objectiveId: string) => Promise<void>;

  setSelectedObjective: (id: string | null) => void;
  clearBrief: () => void;
  clearError: () => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function patchObjectiveInBrief(
  brief: StrategyBrief,
  objectiveId: string,
  patch: Partial<StrategyObjective>,
): StrategyBrief {
  return {
    ...brief,
    objectives: brief.objectives.map((o) =>
      o.id === objectiveId ? { ...o, ...patch } : o,
    ),
  };
}

// ── Store ──────────────────────────────────────────────────────────────────────

export const useStrategyStore = create<StrategyStore>((set, get) => ({
  currentBrief: null,
  selectedObjectiveId: null,
  evaluationLoading: {},
  lockLoading: {},
  briefLoading: false,
  briefLockLoading: false,
  error: null,

  createBrief: async (input) => {
    set({ briefLoading: true, error: null });
    try {
      const brief = await strategyApi.createBrief(input);
      set({ currentBrief: brief, briefLoading: false });
      return brief;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create strategy brief.';
      set({ error: msg, briefLoading: false });
      throw err;
    }
  },

  fetchBrief: async (briefId) => {
    set({ briefLoading: true, error: null });
    try {
      const brief = await strategyApi.getBrief(briefId);
      set({ currentBrief: brief, briefLoading: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load strategy brief.';
      set({ error: msg, briefLoading: false });
      throw err;
    }
  },

  patchBrief: async (briefId, fields) => {
    try {
      await strategyApi.patchBrief(briefId, fields);
      const brief = get().currentBrief;
      if (brief && brief.id === briefId) {
        set({ currentBrief: { ...brief, ...fields } });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update brief.';
      set({ error: msg });
      throw err;
    }
  },

  lockBrief: async (briefId) => {
    set({ briefLockLoading: true, error: null });
    try {
      await strategyApi.lockBrief(briefId);
      const brief = get().currentBrief;
      if (brief && brief.id === briefId) {
        set({ currentBrief: { ...brief, locked_at: new Date().toISOString() }, briefLockLoading: false });
      } else {
        set({ briefLockLoading: false });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to lock brief.';
      set({ error: msg, briefLockLoading: false });
      throw err;
    }
  },

  addObjective: async (briefId, input) => {
    set({ error: null });
    try {
      const result = await strategyApi.addObjective(briefId, input);
      const brief = get().currentBrief;
      if (brief && brief.id === briefId) {
        set({ currentBrief: { ...brief, objectives: [...brief.objectives, result.objective] } });
      }
      return { soft_cap_warning: result.soft_cap_warning };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to add objective.';
      set({ error: msg });
      throw err;
    }
  },

  updateObjective: async (objectiveId, input) => {
    set({ error: null });
    try {
      await strategyApi.patchObjective(objectiveId, input);
      const brief = get().currentBrief;
      if (brief) {
        set({ currentBrief: patchObjectiveInBrief(brief, objectiveId, input) });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update objective.';
      set({ error: msg });
      throw err;
    }
  },

  removeObjective: async (objectiveId) => {
    set({ error: null });
    try {
      await strategyApi.deleteObjective(objectiveId);
      const brief = get().currentBrief;
      if (brief) {
        set({ currentBrief: { ...brief, objectives: brief.objectives.filter((o) => o.id !== objectiveId) } });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to remove objective.';
      set({ error: msg });
      throw err;
    }
  },

  evaluateObjective: async (objectiveId, businessType) => {
    set((s) => ({ evaluationLoading: { ...s.evaluationLoading, [objectiveId]: true }, error: null }));
    try {
      const verdictData = await strategyApi.evaluateObjective(objectiveId, businessType);
      const brief = get().currentBrief;
      if (brief) {
        set({
          currentBrief: patchObjectiveInBrief(brief, objectiveId, {
            verdict: verdictData.verdict,
            recommended_primary_event: verdictData.recommended_primary_event,
            recommended_proxy_event: verdictData.recommended_proxy_event,
            rationale: verdictData.rationale,
            warnings: verdictData.warnings,
          }),
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Evaluation failed. Please try again.';
      set({ error: msg });
      throw err;
    } finally {
      set((s) => ({ evaluationLoading: { ...s.evaluationLoading, [objectiveId]: false } }));
    }
  },

  lockObjective: async (objectiveId) => {
    set((s) => ({ lockLoading: { ...s.lockLoading, [objectiveId]: true }, error: null }));
    try {
      await strategyApi.lockObjective(objectiveId);
      const brief = get().currentBrief;
      if (brief) {
        set({
          currentBrief: patchObjectiveInBrief(brief, objectiveId, {
            locked: true,
            locked_at: new Date().toISOString(),
          }),
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to lock objective.';
      set({ error: msg });
      throw err;
    } finally {
      set((s) => ({ lockLoading: { ...s.lockLoading, [objectiveId]: false } }));
    }
  },

  addCampaign: async (objectiveId, input) => {
    set({ error: null });
    try {
      const campaign = await strategyApi.addCampaign(objectiveId, input) as ObjectiveCampaign;
      const brief = get().currentBrief;
      if (brief) {
        set({
          currentBrief: patchObjectiveInBrief(brief, objectiveId, {
            campaigns: [
              ...(brief.objectives.find((o) => o.id === objectiveId)?.campaigns ?? []),
              campaign,
            ],
          }),
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to add campaign.';
      set({ error: msg });
      throw err;
    }
  },

  removeCampaign: async (campaignId, objectiveId) => {
    set({ error: null });
    try {
      await strategyApi.deleteCampaign(campaignId);
      const brief = get().currentBrief;
      if (brief) {
        const objective = brief.objectives.find((o) => o.id === objectiveId);
        if (objective) {
          set({
            currentBrief: patchObjectiveInBrief(brief, objectiveId, {
              campaigns: objective.campaigns.filter((c) => c.id !== campaignId),
            }),
          });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to remove campaign.';
      set({ error: msg });
      throw err;
    }
  },

  setSelectedObjective: (id) => set({ selectedObjectiveId: id }),

  clearBrief: () =>
    set({ currentBrief: null, selectedObjectiveId: null, evaluationLoading: {}, lockLoading: {}, error: null }),

  clearError: () => set({ error: null }),
}));
