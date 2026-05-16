import { create } from 'zustand';
import { reconciliationApi } from '@/lib/api/reconciliationApi';
import type { ReconciliationRun, ReconciliationFinding, FindingFilters, ToleranceConfig, EventStatGroup } from '@/lib/api/reconciliationApi';

interface ReconciliationState {
  runs: ReconciliationRun[];
  currentRun: ReconciliationRun | null;
  findings: ReconciliationFinding[];
  filters: FindingFilters;
  latestBriefRun: ReconciliationRun | null;
  toleranceConfigs: ToleranceConfig[];
  stats: EventStatGroup[];

  loading: boolean;
  triggering: boolean;
  error: string | null;

  fetchRuns: (clientId: string) => Promise<void>;
  fetchRunDetail: (runId: string) => Promise<void>;
  fetchLatestRunForBrief: (briefId: string, clientId: string) => Promise<void>;
  setFilters: (filters: FindingFilters) => void;
  resolveFinding: (findingId: string) => Promise<void>;
  triggerRun: (clientId: string, briefId?: string) => Promise<string | null>;
  fetchTolerance: (clientId: string) => Promise<void>;
  fetchStats: (clientId: string, opts?: { days?: number; eventName?: string; platform?: string }) => Promise<void>;
  clearError: () => void;
}

export const useReconciliationStore = create<ReconciliationState>((set, get) => ({
  runs: [],
  currentRun: null,
  findings: [],
  filters: {},
  latestBriefRun: null,
  toleranceConfigs: [],
  stats: [],
  loading: false,
  triggering: false,
  error: null,

  fetchRuns: async (clientId: string) => {
    set({ loading: true, error: null });
    try {
      const res = await reconciliationApi.listRuns(clientId);
      set({ runs: res.data, loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load runs', loading: false });
    }
  },

  fetchRunDetail: async (runId: string) => {
    set({ loading: true, error: null });
    try {
      const res = await reconciliationApi.getRun(runId);
      const filters = get().filters;
      let findings = res.data.all_findings;
      if (filters.dimension) findings = findings.filter((f: ReconciliationFinding) => f.dimension === filters.dimension);
      if (filters.severity) findings = findings.filter((f: ReconciliationFinding) => f.severity === filters.severity);
      if (filters.platform) findings = findings.filter((f: ReconciliationFinding) => f.platform === filters.platform);
      if (filters.resolved !== undefined) {
        findings = findings.filter((f: ReconciliationFinding) =>
          filters.resolved ? f.resolved_at !== null : f.resolved_at === null,
        );
      }
      set({ currentRun: res.data.run, findings, loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load run', loading: false });
    }
  },

  fetchLatestRunForBrief: async (briefId: string, clientId: string) => {
    set({ loading: true });
    try {
      const run = await reconciliationApi.getLatestRunForBrief(briefId, clientId);
      if (run) {
        const res = await reconciliationApi.getRun(run.id);
        set({ latestBriefRun: res.data.run, findings: res.data.all_findings, loading: false });
      } else {
        set({ latestBriefRun: null, findings: [], loading: false });
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load brief run', loading: false });
    }
  },

  setFilters: (filters: FindingFilters) => {
    set({ filters });
    const { currentRun } = get();
    if (currentRun) get().fetchRunDetail(currentRun.id);
  },

  resolveFinding: async (findingId: string) => {
    try {
      await reconciliationApi.resolveFinding(findingId);
      set((state) => ({
        findings: state.findings.map((f: ReconciliationFinding) =>
          f.id === findingId ? { ...f, resolved_at: new Date().toISOString() } : f,
        ),
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to resolve finding' });
    }
  },

  triggerRun: async (clientId: string, briefId?: string) => {
    set({ triggering: true, error: null });
    try {
      const res = await reconciliationApi.triggerRun(clientId, briefId);
      await get().fetchRuns(clientId);
      return res.data.runId;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to trigger run' });
      return null;
    } finally {
      set({ triggering: false });
    }
  },

  fetchTolerance: async (clientId: string) => {
    try {
      const res = await reconciliationApi.getTolerance(clientId);
      set({ toleranceConfigs: res.data });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load tolerance config' });
    }
  },

  fetchStats: async (clientId: string, opts?: { days?: number; eventName?: string; platform?: string }) => {
    set({ loading: true });
    try {
      const res = await reconciliationApi.getStats(clientId, opts);
      set({ stats: res.data, loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load stats', loading: false });
    }
  },

  clearError: () => set({ error: null }),
}));
