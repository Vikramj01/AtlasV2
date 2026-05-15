import { create } from 'zustand';
import { reconciliationApi } from '@/lib/api/reconciliationApi';
import type { ReconciliationRun, ReconciliationFinding, FindingFilters } from '@/lib/api/reconciliationApi';

interface ReconciliationState {
  runs: ReconciliationRun[];
  currentRun: ReconciliationRun | null;
  findings: ReconciliationFinding[];
  filters: FindingFilters;
  latestBriefRun: ReconciliationRun | null;

  loading: boolean;
  triggering: boolean;
  error: string | null;

  fetchRuns: (clientId: string) => Promise<void>;
  fetchRunDetail: (runId: string) => Promise<void>;
  fetchLatestRunForBrief: (briefId: string, clientId: string) => Promise<void>;
  setFilters: (filters: FindingFilters) => void;
  resolveFinding: (findingId: string) => Promise<void>;
  triggerRun: (clientId: string, briefId?: string) => Promise<string | null>;
  clearError: () => void;
}

export const useReconciliationStore = create<ReconciliationState>((set, get) => ({
  runs: [],
  currentRun: null,
  findings: [],
  filters: {},
  latestBriefRun: null,
  loading: false,
  triggering: false,
  error: null,

  fetchRuns: async (clientId) => {
    set({ loading: true, error: null });
    try {
      const res = await reconciliationApi.listRuns(clientId);
      set({ runs: res.data, loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load runs', loading: false });
    }
  },

  fetchRunDetail: async (runId) => {
    set({ loading: true, error: null });
    try {
      const res = await reconciliationApi.getRun(runId);
      const filters = get().filters;
      // Apply current filters to the full findings list
      let findings = res.data.all_findings;
      if (filters.dimension) findings = findings.filter((f) => f.dimension === filters.dimension);
      if (filters.severity) findings = findings.filter((f) => f.severity === filters.severity);
      if (filters.platform) findings = findings.filter((f) => f.platform === filters.platform);
      if (filters.resolved !== undefined) {
        findings = findings.filter((f) =>
          filters.resolved ? f.resolved_at !== null : f.resolved_at === null,
        );
      }
      set({ currentRun: res.data.run, findings, loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load run', loading: false });
    }
  },

  fetchLatestRunForBrief: async (briefId, clientId) => {
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

  setFilters: (filters) => {
    set({ filters });
    const { currentRun } = get();
    if (currentRun) get().fetchRunDetail(currentRun.id);
  },

  resolveFinding: async (findingId) => {
    try {
      await reconciliationApi.resolveFinding(findingId);
      set((state) => ({
        findings: state.findings.map((f) =>
          f.id === findingId ? { ...f, resolved_at: new Date().toISOString() } : f,
        ),
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to resolve finding' });
    }
  },

  triggerRun: async (clientId, briefId) => {
    set({ triggering: true, error: null });
    try {
      const res = await reconciliationApi.triggerRun(clientId, briefId);
      // Refresh runs list
      await get().fetchRuns(clientId);
      return res.data.runId;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to trigger run' });
      return null;
    } finally {
      set({ triggering: false });
    }
  },

  clearError: () => set({ error: null }),
}));
