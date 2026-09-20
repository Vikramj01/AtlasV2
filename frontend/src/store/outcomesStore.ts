import { create } from 'zustand';
import { outcomesApi } from '@/lib/api/outcomesApi';
import type {
  OutcomeSourceConfig,
  CreateOutcomeSourceConfigInput,
  CreateWebhookOutcomeSourceConfigInput,
  CreatedWebhookOutcomeSourceConfig,
  ReadinessResult,
  StageMappingsResponse,
  StageMappingInput,
  OutcomeDerivedValueSnapshot,
  OutcomeTierStats,
} from '@/types/outcomes';

interface OutcomeState {
  configs: OutcomeSourceConfig[];
  readiness: Record<string, ReadinessResult>; // keyed by config_id
  stageMappings: Record<string, StageMappingsResponse>; // keyed by config_id
  derivedValues: Record<string, OutcomeDerivedValueSnapshot[]>; // keyed by config_id
  tierStats: Record<string, OutcomeTierStats>; // keyed by config_id
  loading: Record<string, boolean>;
  errors: Record<string, string | null>;

  loadConfigs: () => Promise<void>;
  createConfig: (input: CreateOutcomeSourceConfigInput) => Promise<OutcomeSourceConfig>;
  createWebhookConfig: (input: CreateWebhookOutcomeSourceConfigInput) => Promise<CreatedWebhookOutcomeSourceConfig>;
  checkReadiness: (configId: string) => Promise<ReadinessResult>;
  setSyncEnabled: (configId: string, enabled: boolean) => Promise<void>;
  setWriteBackEnabled: (configId: string, enabled: boolean) => Promise<void>;
  setDeliveryEnabled: (configId: string, enabled: boolean) => Promise<void>;
  loadTierStats: (configId: string) => Promise<void>;
  loadStageMappings: (configId: string) => Promise<void>;
  saveStageMappings: (configId: string, mappings: StageMappingInput[]) => Promise<void>;
  loadDerivedValues: (configId: string) => Promise<void>;
  clearError: (key: string) => void;
}

export const useOutcomesStore = create<OutcomeState>((set) => ({
  configs: [],
  readiness: {},
  stageMappings: {},
  derivedValues: {},
  tierStats: {},
  loading: {},
  errors: {},

  loadConfigs: async () => {
    const key = 'configs';
    set((s) => ({ loading: { ...s.loading, [key]: true }, errors: { ...s.errors, [key]: null } }));
    try {
      const configs = await outcomesApi.listConfigs();
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
      const config = await outcomesApi.createConfig(input);
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

  createWebhookConfig: async (input) => {
    const key = 'create-webhook-config';
    set((s) => ({ loading: { ...s.loading, [key]: true }, errors: { ...s.errors, [key]: null } }));
    try {
      const created = await outcomesApi.createWebhookConfig(input);
      set((s) => ({ configs: [created, ...s.configs], loading: { ...s.loading, [key]: false } }));
      return created;
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
      const result = await outcomesApi.checkReadiness(configId);
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
      const updated = await outcomesApi.updateConfig(configId, { sync_enabled: enabled });
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

  setWriteBackEnabled: async (configId, enabled) => {
    const key = `write-back-enabled-${configId}`;
    set((s) => ({ loading: { ...s.loading, [key]: true }, errors: { ...s.errors, [key]: null } }));
    try {
      const updated = await outcomesApi.updateConfig(configId, { write_back_enabled: enabled });
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

  setDeliveryEnabled: async (configId, enabled) => {
    const key = `delivery-enabled-${configId}`;
    set((s) => ({ loading: { ...s.loading, [key]: true }, errors: { ...s.errors, [key]: null } }));
    try {
      const updated = await outcomesApi.updateConfig(configId, { delivery_enabled: enabled });
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

  loadTierStats: async (configId) => {
    const key = `tier-stats-${configId}`;
    set((s) => ({ loading: { ...s.loading, [key]: true }, errors: { ...s.errors, [key]: null } }));
    try {
      const stats = await outcomesApi.getConfigTiers(configId);
      set((s) => ({
        tierStats: { ...s.tierStats, [configId]: stats },
        loading: { ...s.loading, [key]: false },
      }));
    } catch (err) {
      set((s) => ({
        loading: { ...s.loading, [key]: false },
        errors: { ...s.errors, [key]: (err as Error).message },
      }));
    }
  },

  loadStageMappings: async (configId) => {
    const key = `stage-mappings-${configId}`;
    set((s) => ({ loading: { ...s.loading, [key]: true }, errors: { ...s.errors, [key]: null } }));
    try {
      const result = await outcomesApi.getStageMappings(configId);
      set((s) => ({
        stageMappings: { ...s.stageMappings, [configId]: result },
        loading: { ...s.loading, [key]: false },
      }));
    } catch (err) {
      set((s) => ({
        loading: { ...s.loading, [key]: false },
        errors: { ...s.errors, [key]: (err as Error).message },
      }));
    }
  },

  saveStageMappings: async (configId, mappings) => {
    const key = `stage-mappings-save-${configId}`;
    set((s) => ({ loading: { ...s.loading, [key]: true }, errors: { ...s.errors, [key]: null } }));
    try {
      const result = await outcomesApi.replaceStageMappings(configId, mappings);
      set((s) => ({
        stageMappings: { ...s.stageMappings, [configId]: result },
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

  loadDerivedValues: async (configId) => {
    const key = `derived-values-${configId}`;
    set((s) => ({ loading: { ...s.loading, [key]: true }, errors: { ...s.errors, [key]: null } }));
    try {
      const result = await outcomesApi.getDerivedValues(configId);
      set((s) => ({
        derivedValues: { ...s.derivedValues, [configId]: result },
        loading: { ...s.loading, [key]: false },
      }));
    } catch (err) {
      set((s) => ({
        loading: { ...s.loading, [key]: false },
        errors: { ...s.errors, [key]: (err as Error).message },
      }));
    }
  },

  clearError: (key) => set((s) => ({ errors: { ...s.errors, [key]: null } })),
}));
