import { create } from 'zustand';
import { crmApi } from '@/lib/api/crmApi';
import type { CrmSyncConfig, CreateCrmSyncConfigInput, ReadinessResult } from '@/types/crm';

interface CrmState {
  configs: CrmSyncConfig[];
  readiness: Record<string, ReadinessResult>; // keyed by config_id
  loading: Record<string, boolean>;
  errors: Record<string, string | null>;

  loadConfigs: () => Promise<void>;
  createConfig: (input: CreateCrmSyncConfigInput) => Promise<CrmSyncConfig>;
  checkReadiness: (configId: string) => Promise<ReadinessResult>;
  setSyncEnabled: (configId: string, enabled: boolean) => Promise<void>;
  clearError: (key: string) => void;
}

export const useCrmStore = create<CrmState>((set) => ({
  configs: [],
  readiness: {},
  loading: {},
  errors: {},

  loadConfigs: async () => {
    const key = 'configs';
    set((s) => ({ loading: { ...s.loading, [key]: true }, errors: { ...s.errors, [key]: null } }));
    try {
      const configs = await crmApi.listConfigs();
      set((s) => ({ configs, loading: { ...s.loading, [key]: false } }));
    } catch (err) {
      set((s) => ({
        loading: { ...s.loading, [key]: false },
        errors: { ...s.errors, [key]: (err as Error).message },
      }));
    }
  },

  createConfig: async (input) => {
    const key = 'create-config';
    set((s) => ({ loading: { ...s.loading, [key]: true }, errors: { ...s.errors, [key]: null } }));
    try {
      const config = await crmApi.createConfig(input);
      set((s) => ({ configs: [config, ...s.configs], loading: { ...s.loading, [key]: false } }));
      return config;
    } catch (err) {
      set((s) => ({
        loading: { ...s.loading, [key]: false },
        errors: { ...s.errors, [key]: (err as Error).message },
      }));
      throw err;
    }
  },

  checkReadiness: async (configId) => {
    const key = `readiness-${configId}`;
    set((s) => ({ loading: { ...s.loading, [key]: true }, errors: { ...s.errors, [key]: null } }));
    try {
      const result = await crmApi.checkReadiness(configId);
      set((s) => ({
        readiness: { ...s.readiness, [configId]: result },
        loading: { ...s.loading, [key]: false },
      }));
      return result;
    } catch (err) {
      set((s) => ({
        loading: { ...s.loading, [key]: false },
        errors: { ...s.errors, [key]: (err as Error).message },
      }));
      throw err;
    }
  },

  setSyncEnabled: async (configId, enabled) => {
    const key = `sync-enabled-${configId}`;
    set((s) => ({ loading: { ...s.loading, [key]: true }, errors: { ...s.errors, [key]: null } }));
    try {
      const updated = await crmApi.updateConfig(configId, { sync_enabled: enabled });
      set((s) => ({
        configs: s.configs.map((c) => (c.id === configId ? updated : c)),
        loading: { ...s.loading, [key]: false },
      }));
    } catch (err) {
      set((s) => ({
        loading: { ...s.loading, [key]: false },
        errors: { ...s.errors, [key]: (err as Error).message },
      }));
      throw err;
    }
  },

  clearError: (key) => set((s) => ({ errors: { ...s.errors, [key]: null } })),
}));
