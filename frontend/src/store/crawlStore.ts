import { create } from 'zustand';
import { crawlApi } from '@/lib/api/crawlApi';
import type { CrawlRunSummary, CrawlPageResult } from '@/types/crawl';

// Module-level interval handle — kept outside Zustand to avoid serialisation issues
let _pollInterval: ReturnType<typeof setInterval> | null = null;

interface CrawlState {
  currentRunId: string | null;
  run: CrawlRunSummary | null;
  pages: CrawlPageResult[];
  isPolling: boolean;
  error: string | null;

  setCurrentRun: (runId: string) => void;
  fetchRun: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
  reset: () => void;
}

export const useCrawlStore = create<CrawlState>((set, get) => ({
  currentRunId: null,
  run:          null,
  pages:        [],
  isPolling:    false,
  error:        null,

  setCurrentRun: (runId) => set({ currentRunId: runId, run: null, pages: [], error: null }),

  fetchRun: async () => {
    const { currentRunId } = get();
    if (!currentRunId) return;
    try {
      const { run, pages } = await crawlApi.getRun(currentRunId);
      set({ run, pages, error: null });

      // Auto-stop polling when the run reaches a terminal state
      const terminal = run.status === 'completed' || run.status === 'failed' || run.status === 'partial';
      if (terminal) get().stopPolling();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to fetch crawl run' });
    }
  },

  startPolling: () => {
    if (_pollInterval !== null) return; // already polling

    set({ isPolling: true });
    // Fetch immediately, then every 5 seconds
    get().fetchRun();
    _pollInterval = setInterval(() => get().fetchRun(), 5000);
  },

  stopPolling: () => {
    if (_pollInterval !== null) {
      clearInterval(_pollInterval);
      _pollInterval = null;
    }
    set({ isPolling: false });
  },

  reset: () => {
    if (_pollInterval !== null) {
      clearInterval(_pollInterval);
      _pollInterval = null;
    }
    set({ currentRunId: null, run: null, pages: [], isPolling: false, error: null });
  },
}));
