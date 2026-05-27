import { create } from 'zustand';
import type { OnboardingStatus } from '@/types/onboarding';
import { onboardingApi } from '@/lib/api/onboardingApi';

interface OnboardingStore {
  status: OnboardingStatus | null;
  isLoading: boolean;
  error: string | null;

  // Derived
  completedCount: number;
  totalSteps: number;
  overallProgress: number;

  // Actions
  fetchStatus: () => Promise<void>;
  skipStep: (stepId: string) => Promise<void>;
  dismiss: () => Promise<void>;
  reset: () => Promise<void>;
  acceptTaxonomy: () => Promise<void>;
}

function deriveProgress(status: OnboardingStatus | null): { completedCount: number; overallProgress: number } {
  if (!status) return { completedCount: 0, overallProgress: 0 };
  const steps = Object.values(status.steps);
  const completed = steps.filter((s) => s.status === 'complete').length;
  return { completedCount: completed, overallProgress: Math.round((completed / 9) * 100) };
}

export const useOnboardingStore = create<OnboardingStore>((set, get) => ({
  status: null,
  isLoading: false,
  error: null,
  completedCount: 0,
  totalSteps: 9,
  overallProgress: 0,

  fetchStatus: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await onboardingApi.getStatus();
      const { completedCount, overallProgress } = deriveProgress(res.data);
      set({ status: res.data, completedCount, overallProgress, isLoading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load onboarding status', isLoading: false });
    }
  },

  skipStep: async (stepId) => {
    await onboardingApi.skipStep(stepId);
    await get().fetchStatus();
  },

  dismiss: async () => {
    await onboardingApi.dismiss();
    await get().fetchStatus();
  },

  reset: async () => {
    await onboardingApi.reset();
    await get().fetchStatus();
  },

  acceptTaxonomy: async () => {
    await onboardingApi.acceptTaxonomy();
    await get().fetchStatus();
  },
}));
