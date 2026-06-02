import { create } from 'zustand';
import { enrichmentApi } from '@/lib/api/enrichmentApi';
import type {
  ClientIdentityConfig,
  SignalEnrichmentConfig,
  ClientEnrichmentScore,
  SaveIdentityConfigRequest,
  SaveSignalEnrichmentRequest,
  ValidateFieldPathRequest,
  ValidateFieldPathResponse,
} from '@/types/enrichment';

interface EnrichmentState {
  identityConfigs: Record<string, ClientIdentityConfig>;         // keyed by client_id
  signalEnrichments: Record<string, SignalEnrichmentConfig[]>;   // keyed by deployment_id
  enrichmentScores: Record<string, ClientEnrichmentScore>;       // keyed by client_id
  loading: Record<string, boolean>;
  errors: Record<string, string | null>;

  loadIdentityConfig: (orgId: string, clientId: string) => Promise<void>;
  saveIdentityConfig: (orgId: string, clientId: string, req: SaveIdentityConfigRequest) => Promise<void>;
  loadSignalEnrichments: (orgId: string, clientId: string, deploymentId: string) => Promise<void>;
  saveSignalEnrichment: (
    orgId: string,
    clientId: string,
    deploymentId: string,
    signalKey: string,
    req: SaveSignalEnrichmentRequest,
  ) => Promise<void>;
  loadEnrichmentScore: (orgId: string, clientId: string) => Promise<void>;
  validateFieldPath: (
    orgId: string,
    clientId: string,
    req: ValidateFieldPathRequest,
  ) => Promise<ValidateFieldPathResponse>;
  clearError: (key: string) => void;
}

export const useEnrichmentStore = create<EnrichmentState>((set) => ({
  identityConfigs: {},
  signalEnrichments: {},
  enrichmentScores: {},
  loading: {},
  errors: {},

  loadIdentityConfig: async (orgId, clientId) => {
    const key = `identity-${clientId}`;
    set((s) => ({ loading: { ...s.loading, [key]: true }, errors: { ...s.errors, [key]: null } }));
    try {
      const config = await enrichmentApi.getIdentityConfig(orgId, clientId);
      set((s) => ({
        identityConfigs: { ...s.identityConfigs, [clientId]: config as ClientIdentityConfig },
        loading: { ...s.loading, [key]: false },
      }));
    } catch (err) {
      set((s) => ({
        loading: { ...s.loading, [key]: false },
        errors: { ...s.errors, [key]: (err as Error).message },
      }));
    }
  },

  saveIdentityConfig: async (orgId, clientId, req) => {
    const key = `identity-save-${clientId}`;
    set((s) => ({ loading: { ...s.loading, [key]: true }, errors: { ...s.errors, [key]: null } }));
    try {
      const config = await enrichmentApi.saveIdentityConfig(orgId, clientId, req);
      set((s) => ({
        identityConfigs: { ...s.identityConfigs, [clientId]: config },
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

  loadSignalEnrichments: async (orgId, clientId, deploymentId) => {
    const key = `enrichments-${deploymentId}`;
    set((s) => ({ loading: { ...s.loading, [key]: true }, errors: { ...s.errors, [key]: null } }));
    try {
      const configs = await enrichmentApi.listSignalEnrichments(orgId, clientId, deploymentId);
      set((s) => ({
        signalEnrichments: { ...s.signalEnrichments, [deploymentId]: configs },
        loading: { ...s.loading, [key]: false },
      }));
    } catch (err) {
      set((s) => ({
        loading: { ...s.loading, [key]: false },
        errors: { ...s.errors, [key]: (err as Error).message },
      }));
    }
  },

  saveSignalEnrichment: async (orgId, clientId, deploymentId, signalKey, req) => {
    const key = `enrichment-save-${deploymentId}-${signalKey}`;
    set((s) => ({ loading: { ...s.loading, [key]: true }, errors: { ...s.errors, [key]: null } }));
    try {
      const { data: saved } = await enrichmentApi.saveSignalEnrichment(orgId, clientId, deploymentId, signalKey, req);
      set((s) => {
        const existing = s.signalEnrichments[deploymentId] ?? [];
        const updated = existing.some((e) => e.signal_key === signalKey)
          ? existing.map((e) => (e.signal_key === signalKey ? saved : e))
          : [...existing, saved];
        return {
          signalEnrichments: { ...s.signalEnrichments, [deploymentId]: updated },
          loading: { ...s.loading, [key]: false },
        };
      });
    } catch (err) {
      set((s) => ({
        loading: { ...s.loading, [key]: false },
        errors: { ...s.errors, [key]: (err as Error).message },
      }));
      throw err;
    }
  },

  loadEnrichmentScore: async (orgId, clientId) => {
    const key = `score-${clientId}`;
    set((s) => ({ loading: { ...s.loading, [key]: true }, errors: { ...s.errors, [key]: null } }));
    try {
      const score = await enrichmentApi.getEnrichmentScore(orgId, clientId);
      set((s) => ({
        enrichmentScores: { ...s.enrichmentScores, [clientId]: score },
        loading: { ...s.loading, [key]: false },
      }));
    } catch (err) {
      set((s) => ({
        loading: { ...s.loading, [key]: false },
        errors: { ...s.errors, [key]: (err as Error).message },
      }));
    }
  },

  validateFieldPath: async (orgId, clientId, req) => {
    return enrichmentApi.validateFieldPath(orgId, clientId, req);
  },

  clearError: (key) => set((s) => ({ errors: { ...s.errors, [key]: null } })),
}));
