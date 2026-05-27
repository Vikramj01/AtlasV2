import { create } from 'zustand';
import type { TrackingStatus, HubState } from '@/types/tracking';
import { deriveHubState } from '@/types/tracking';
import {
  fetchTrackingStatus,
  buildDeliverables,
  exportDeliverable,
  generateShareLink as apiGenerateShareLink,
} from '@/lib/api/trackingApi';

interface TrackingHubState {
  status: TrackingStatus | null;
  hubState: HubState;
  isLoading: boolean;
  error: string | null;
  shareUrl: string | null;
  shareExpiry: string | null;
  isGeneratingDeliverables: boolean;
  isGeneratingShareLink: boolean;

  fetchStatus: (clientId: string) => Promise<void>;
  discardInProgress: (module: 'planning' | 'journey' | 'crawl', id: string) => void;
  buildAndDownloadDeliverables: (
    clientId: string,
    type: 'gtm_container' | 'datalayer_spec',
  ) => Promise<void>;
  generateShareLink: (clientId: string, expiresInDays: number) => Promise<void>;
  reset: () => void;
}

export const useTrackingHubStore = create<TrackingHubState>((set, get) => ({
  status: null,
  hubState: 'empty',
  isLoading: false,
  error: null,
  shareUrl: null,
  shareExpiry: null,
  isGeneratingDeliverables: false,
  isGeneratingShareLink: false,

  fetchStatus: async (clientId) => {
    set({ isLoading: true, error: null });
    try {
      const status = await fetchTrackingStatus(clientId);
      set({ status, hubState: deriveHubState(status), isLoading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load tracking status', isLoading: false });
    }
  },

  discardInProgress: (module, id) => {
    const { status } = get();
    if (!status) return;
    const updatedInProgress = { ...status.in_progress };
    if (module === 'planning') updatedInProgress.planning_session = null;
    if (module === 'journey') updatedInProgress.journey_draft = null;
    if (module === 'crawl') updatedInProgress.recent_crawl = null;
    const updatedStatus = { ...status, in_progress: updatedInProgress };
    set({ status: updatedStatus, hubState: deriveHubState(updatedStatus) });
  },

  buildAndDownloadDeliverables: async (clientId, type) => {
    set({ isGeneratingDeliverables: true, error: null });
    try {
      const result = await buildDeliverables(clientId);
      const filename = type === 'gtm_container'
        ? 'atlas-gtm-container.json'
        : 'atlas-datalayer-spec.json';
      const content = type === 'gtm_container' ? result.gtm_container : result.datalayer_spec;
      const blob = new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      await exportDeliverable(clientId, type);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Download failed' });
    } finally {
      set({ isGeneratingDeliverables: false });
    }
  },

  generateShareLink: async (clientId, expiresInDays) => {
    set({ isGeneratingShareLink: true, error: null, shareUrl: null });
    try {
      const result = await apiGenerateShareLink(clientId, expiresInDays);
      set({ shareUrl: result.share_url, shareExpiry: result.expires_at });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to generate share link' });
    } finally {
      set({ isGeneratingShareLink: false });
    }
  },

  reset: () => set({
    status: null, hubState: 'empty', isLoading: false, error: null,
    shareUrl: null, shareExpiry: null, isGeneratingDeliverables: false, isGeneratingShareLink: false,
  }),
}));
