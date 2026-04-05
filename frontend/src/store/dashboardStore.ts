/**
 * Dashboard store — holds DashboardResponse with 5-minute auto-refresh.
 *
 * Call `startPolling()` when the dashboard page mounts and
 * `stopPolling()` when it unmounts to avoid background requests.
 */

import { create } from 'zustand';
import { dashboardApi } from '@/lib/api/dashboardApi';
import type { DashboardResponse } from '@/types/dashboard';

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

type LoadState = 'idle' | 'loading' | 'loaded' | 'error';

interface DashboardStore {
  data: DashboardResponse | null;
  loadState: LoadState;
  lastFetchedAt: Date | null;
  /** Fetch once immediately. */
  fetch: () => Promise<void>;
  /** Begin polling every 5 minutes. Returns a cleanup function. */
  startPolling: () => () => void;
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
}));
