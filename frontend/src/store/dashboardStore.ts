import { create } from 'zustand';
import { dashboardApi } from '@/lib/api/dashboardApi';
import type { DashboardResponse, OrgDashboardSummary, DashboardAlertItem } from '@/types/dashboard';

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

type LoadState = 'idle' | 'loading' | 'loaded' | 'error';

interface DashboardStore {
  data: DashboardResponse | null;
  loadState: LoadState;
  lastFetchedAt: Date | null;
  fetch: () => Promise<void>;
  startPolling: () => () => void;

  // PRD-004: org summary
  summary: OrgDashboardSummary | null;
  summaryLoadState: LoadState;
  sinceTimestamp: string | undefined;
  fetchSummary: (since?: string) => Promise<void>;
  reviewAlert: (sourceTable: string, sourceId: string) => Promise<void>;
  reviewAll: () => Promise<void>;
  setSinceTimestamp: (since: string | undefined) => void;
}

export const useDashboardStore = create<DashboardStore>((set, get) => ({
  data: null,
  loadState: 'idle',
  lastFetchedAt: null,

  fetch: async () => {
    set({ loadState: 'loading' });
    try {
      const data = await dashboardApi.get();
      set({ data, loadState: 'loaded', lastFetchedAt: new Date() });
    } catch {
      set({ loadState: 'error' });
    }
  },

  startPolling: () => {
    const { fetch } = get();
    fetch();
    const interval = setInterval(fetch, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  },

  // PRD-004 summary
  summary: null,
  summaryLoadState: 'idle',
  sinceTimestamp: undefined,

  fetchSummary: async (since?: string) => {
    set({ summaryLoadState: 'loading' });
    try {
      const res = await dashboardApi.fetchSummary(since);
      set({ summary: res.data, summaryLoadState: 'loaded' });
    } catch {
      set({ summaryLoadState: 'error' });
    }
  },

  reviewAlert: async (sourceTable: string, sourceId: string) => {
    try {
      await dashboardApi.reviewAlerts([{ source_table: sourceTable, source_id: sourceId }]);
      set((state) => ({
        summary: state.summary
          ? {
              ...state.summary,
              alerts: state.summary.alerts.map((a: DashboardAlertItem) =>
                a.source_table === sourceTable && a.id === sourceId
                  ? { ...a, is_reviewed: true }
                  : a,
              ),
            }
          : null,
      }));
    } catch {
      // Non-blocking — review failure is silent
    }
  },

  reviewAll: async () => {
    const { summary } = get();
    if (!summary) return;
    const unreviewed = summary.alerts.filter((a: DashboardAlertItem) => !a.is_reviewed);
    if (unreviewed.length === 0) return;
    try {
      await dashboardApi.reviewAlerts(
        unreviewed.map((a: DashboardAlertItem) => ({ source_table: a.source_table, source_id: a.id })),
      );
      set((state) => ({
        summary: state.summary
          ? {
              ...state.summary,
              alerts: state.summary.alerts.map((a: DashboardAlertItem) => ({ ...a, is_reviewed: true })),
            }
          : null,
      }));
    } catch {
      // Non-blocking
    }
  },

  setSinceTimestamp: (since) => set({ sinceTimestamp: since }),
}));
