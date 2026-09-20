import { create } from 'zustand';
import { outcomesApi } from '@/lib/api/outcomesApi';
import type {
  OutcomeSourceConfig,
  CreateOutcomeSourceConfigInput,
  ReadinessResult,
  StageMappingsResponse,
  StageMappingInput,
  OutcomeDerivedValueSnapshot,
} from '@/types/outcomes';

interface OutcomeState {
  configs: OutcomeSourceConfig[];
  readiness: Record<string, ReadinessResult>; // keyed by config_id
  stageMappings: Record<string, StageMappingsResponse>; // keyed by config_id
  derivedValues: Record<string, OutcomeDerivedValueSnapshot[]>; // keyed by config_id
  loading: Record<string, boolean>;
  errors: Record<string, string | null>;

  loadConfigs: () => Promise<void>;
  createConfig: (input: CreateOutcomeSourceConfigInput) => Promise<OutcomeSourceConfig>;
  checkReadiness: (configId: string) => Promise<ReadinessResult>;
  setSyncEnabled: (configId: string, enabled: boolean) => Promise<void>;
  setWriteBackEnabled: (configId: string, enabled: boolean) => Promise<void>;
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
