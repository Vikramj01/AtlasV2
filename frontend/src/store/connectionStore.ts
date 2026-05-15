import { create } from 'zustand';
import { connectionApi } from '@/lib/api/connectionApi';
import type {
  ConnectionsResponse,
  DiscoveredAccount,
  Platform,
} from '@/types/connections';

interface TestResult {
  ok: boolean;
  latency_ms: number;
  error?: string;
}

interface ConnectionState {
  connections: ConnectionsResponse | null;
  loading: boolean;
  error: string | null;

  // OAuth flow state
  oauthInProgress: Platform | null;
  pendingState: string | null;          // HMAC state stored before redirect
  discoveredAccounts: DiscoveredAccount[];
  standaloneDiscovered: DiscoveredAccount[];
  showPickerForManager: string | null;  // connection id of manager needing account picker

  // Per-connection test results
  testResults: Record<string, TestResult>;
  testingId: string | null;

  // Per-connection loading state (connect/disconnect/rediscover)
  actionLoadingId: string | null;

  fetchConnections: () => Promise<void>;
  startOAuth: (platform: Platform, clientId?: string) => Promise<void>;
  handleOAuthReturn: (platform: Platform, code: string, state: string) => Promise<void>;
  connectAccount: (connectionId: string, clientId: string) => Promise<void>;
  disconnectAccount: (connectionId: string) => Promise<void>;
  rediscover: (connectionId: string) => Promise<DiscoveredAccount[]>;
  removeConnection: (connectionId: string) => Promise<void>;
  testConnection: (connectionId: string) => Promise<void>;
  clearPicker: () => void;
  clearError: () => void;
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  connections: null,
  loading: false,
  error: null,
  oauthInProgress: null,
  pendingState: null,
  discoveredAccounts: [],
  standaloneDiscovered: [],
  showPickerForManager: null,
  testResults: {},
  testingId: null,
  actionLoadingId: null,

  fetchConnections: async () => {
    set({ loading: true, error: null });
    try {
      const res = await connectionApi.list();
      set({ connections: res.data, loading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to load connections',
        loading: false,
      });
    }
  },

  startOAuth: async (platform, clientId) => {
    set({ oauthInProgress: platform, error: null });
    try {
      const res = await connectionApi.startOAuth(platform, clientId);
      // Store state for HMAC verification on callback
      set({ pendingState: res.data.state });
      // Navigate the browser to the platform auth page
      window.location.href = res.data.authUrl;
    } catch (err) {
      set({
        oauthInProgress: null,
        error: err instanceof Error ? err.message : 'Failed to start OAuth',
      });
    }
  },

  // Called by the OAuth callback page after the platform redirects back.
  // Passes the code + stored state to the backend for processing.
  handleOAuthReturn: async (platform, code, state) => {
    set({ oauthInProgress: platform, error: null });
    try {
      const res = await connectionApi.processCallback(platform, code, state);
      const { managerId, discovered, standaloneDiscovered } = res.data;

      set({
        discoveredAccounts: discovered,
        standaloneDiscovered,
        showPickerForManager: managerId ?? null,
        oauthInProgress: null,
        pendingState: null,
      });

      // Refresh the full connections list so new rows appear
      await get().fetchConnections();
    } catch (err) {
      set({
        oauthInProgress: null,
        error: err instanceof Error ? err.message : 'OAuth callback failed',
      });
    }
  },

  connectAccount: async (connectionId, clientId) => {
    set({ actionLoadingId: connectionId, error: null });
    try {
      await connectionApi.connect(connectionId, clientId);
      await get().fetchConnections();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to connect account' });
    } finally {
      set({ actionLoadingId: null });
    }
  },

  disconnectAccount: async (connectionId) => {
    set({ actionLoadingId: connectionId, error: null });
    try {
      await connectionApi.disconnect(connectionId);
      await get().fetchConnections();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to disconnect account' });
    } finally {
      set({ actionLoadingId: null });
    }
  },

  rediscover: async (connectionId) => {
    set({ actionLoadingId: connectionId, error: null });
    try {
      const res = await connectionApi.rediscover(connectionId);
      await get().fetchConnections();
      return res.data;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to re-discover accounts' });
      return [];
    } finally {
      set({ actionLoadingId: null });
    }
  },

  removeConnection: async (connectionId) => {
    set({ actionLoadingId: connectionId, error: null });
    try {
      await connectionApi.remove(connectionId);
      await get().fetchConnections();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to remove connection' });
    } finally {
      set({ actionLoadingId: null });
    }
  },

  testConnection: async (connectionId) => {
    set({ testingId: connectionId });
    try {
      const res = await connectionApi.test(connectionId);
      set((state) => ({
        testResults: { ...state.testResults, [connectionId]: res.data },
        testingId: null,
      }));
    } catch (err) {
      set((state) => ({
        testResults: {
          ...state.testResults,
          [connectionId]: {
            ok: false,
            latency_ms: 0,
            error: err instanceof Error ? err.message : 'Test failed',
          },
        },
        testingId: null,
      }));
    }
  },

  clearPicker: () => set({
    showPickerForManager: null,
    discoveredAccounts: [],
    standaloneDiscovered: [],
  }),

  clearError: () => set({ error: null }),
}));
