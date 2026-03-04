import { create } from 'zustand';
import type { BusinessType, ImplementationFormat, Platform, WizardStage, WizardPlatformSelection, WizardState } from '../types/journey';
import { DEFAULT_STAGES, PLATFORM_OPTIONS } from '../types/journey';
import type { SavedTemplate } from '../lib/api/journeyApi';

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function makeDefaultPlatforms(): WizardPlatformSelection[] {
  return PLATFORM_OPTIONS.map((p) => ({
    platform: p.value,
    isActive: p.defaultActive,
    measurementId: '',
  }));
}

function makeDefaultStages(type: BusinessType): WizardStage[] {
  return DEFAULT_STAGES[type].map((s) => ({ ...s, id: generateId() }));
}

interface JourneyWizardStore extends WizardState {
  // Step navigation
  goToStep: (step: 1 | 2 | 3 | 4) => void;
  canProceedFromStep: (step: number) => boolean;

  // Step 1
  setBusinessType: (type: BusinessType) => void;

  // Step 2 — stages
  addStage: (afterOrder: number) => void;
  removeStage: (stageId: string) => void;
  updateStageLabel: (stageId: string, label: string) => void;
  updateStageUrl: (stageId: string, url: string) => void;
  toggleAction: (stageId: string, actionKey: string) => void;
  reorderStages: (reorderedStages: WizardStage[]) => void;

  // Step 3 — platforms
  togglePlatform: (platform: Platform) => void;
  setPlatformId: (platform: Platform, id: string) => void;
  setImplementationFormat: (format: ImplementationFormat) => void;

  // Load from saved template (pre-fills stages, jumps to step 2)
  loadFromTemplate: (template: SavedTemplate) => void;

  // Reset
  reset: () => void;
}

const INITIAL_STATE: WizardState = {
  currentStep: 1,
  businessType: null,
  stages: [],
  platforms: makeDefaultPlatforms(),
  implementationFormat: 'gtm',
};

export const useJourneyWizardStore = create<JourneyWizardStore>((set, get) => ({
  ...INITIAL_STATE,

  goToStep(step) {
    set({ currentStep: step });
  },

  canProceedFromStep(step) {
    const { businessType, stages } = get();
    if (step === 1) return businessType !== null;
    if (step === 2) {
      if (stages.length < 2) return false;
      const hasAction = stages.some((s) => s.actions.length > 0);
      return hasAction;
    }
    if (step === 3) {
      const { platforms } = get();
      return platforms.some((p) => p.isActive);
    }
    return true;
  },

  setBusinessType(type) {
    set({
      businessType: type,
      stages: makeDefaultStages(type),
    });
  },

  addStage(afterOrder) {
    const { stages } = get();
    const newStage: WizardStage = {
      id: generateId(),
      order: afterOrder + 1,
      label: 'New Stage',
      pageType: 'custom',
      sampleUrl: '',
      actions: [],
    };

    const updated = stages
      .map((s) => (s.order > afterOrder ? { ...s, order: s.order + 1 } : s))
      .concat(newStage)
      .sort((a, b) => a.order - b.order);

    set({ stages: updated });
  },

  removeStage(stageId) {
    const { stages } = get();
    const filtered = stages
      .filter((s) => s.id !== stageId)
      .map((s, i) => ({ ...s, order: i + 1 }));
    set({ stages: filtered });
  },

  updateStageLabel(stageId, label) {
    set({ stages: get().stages.map((s) => (s.id === stageId ? { ...s, label } : s)) });
  },

  updateStageUrl(stageId, url) {
    set({ stages: get().stages.map((s) => (s.id === stageId ? { ...s, sampleUrl: url } : s)) });
  },

  toggleAction(stageId, actionKey) {
    set({
      stages: get().stages.map((s) => {
        if (s.id !== stageId) return s;
        const actions = s.actions.includes(actionKey)
          ? s.actions.filter((a) => a !== actionKey)
          : [...s.actions, actionKey];
        return { ...s, actions };
      }),
    });
  },

  reorderStages(reorderedStages) {
    set({ stages: reorderedStages.map((s, i) => ({ ...s, order: i + 1 })) });
  },

  togglePlatform(platform) {
    set({
      platforms: get().platforms.map((p) =>
        p.platform === platform ? { ...p, isActive: !p.isActive } : p,
      ),
    });
  },

  setPlatformId(platform, id) {
    set({
      platforms: get().platforms.map((p) =>
        p.platform === platform ? { ...p, measurementId: id } : p,
      ),
    });
  },

  setImplementationFormat(format) {
    set({ implementationFormat: format });
  },

  loadFromTemplate(template) {
    const stages: WizardStage[] = template.template_data.stages.map((s) => ({
      id: generateId(),
      order: s.order,
      label: s.label,
      pageType: s.page_type as WizardStage['pageType'],
      sampleUrl: '',
      actions: s.actions,
    }));
    set({
      businessType: template.business_type,
      stages,
      currentStep: 2,
    });
  },

  reset() {
    set({ ...INITIAL_STATE, platforms: makeDefaultPlatforms() });
  },
}));
