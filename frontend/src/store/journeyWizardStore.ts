import { create } from 'zustand';
import type { BusinessType, ImplementationFormat, Platform, WizardStage, WizardPlatformSelection, WizardState, JourneyDuration, StageTimingMap } from '../types/journey';
import { DEFAULT_STAGES, PLATFORM_OPTIONS } from '../types/journey';
import { buildTimingResult } from '../lib/journey/classifyEvent';
import type { SavedTemplate } from '../lib/api/journeyApi';

export type TransportRoute = 'tag_only' | 'gtm_destinations' | 'dma_push' | 'combination';

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
  goToStep: (step: 1 | 2 | 3 | 4 | 5 | 6) => void;
  canProceedFromStep: (step: number) => boolean;

  // Step 1
  setBusinessType: (type: BusinessType) => void;

  // Step 2 — stages
  addStage: (afterOrder: number) => void;
  removeStage: (stageId: string) => void;
  updateStageLabel: (stageId: string, label: string) => void;
  updateStageUrl: (stageId: string, url: string) => void;
  updateStageProxyValue: (stageId: string, value: number | undefined) => void;
  toggleAction: (stageId: string, actionKey: string) => void;
  reorderStages: (reorderedStages: WizardStage[]) => void;

  // Step 2 — signal timing
  stageTiming: StageTimingMap;
  setStageJourneyDuration: (stageId: string, duration: JourneyDuration) => void;
  addProxyStage: (parentStageId: string, proxyActionKey: string, proxyLabel: string, duration: JourneyDuration) => void;
  removeProxyStage: (stageId: string) => void;

  // Step 3 — per-event transport routing
  transportRoutes: Record<string, TransportRoute>;
  setTransportRoute: (stageId: string, route: TransportRoute) => void;

  // Step 4 — GTG pre-flight
  gtgPreflightDismissed: boolean;
  setGtgPreflightDismissed: (v: boolean) => void;

  // Step 5 — platforms
  togglePlatform: (platform: Platform) => void;
  setPlatformId: (platform: Platform, id: string) => void;
  setImplementationFormat: (format: ImplementationFormat) => void;

  // Load from saved template (pre-fills stages, jumps to step 2)
  loadFromTemplate: (template: SavedTemplate) => void;

  // Reset
  reset: () => void;
}

const INITIAL_STATE: WizardState & { stageTiming: StageTimingMap; transportRoutes: Record<string, TransportRoute>; gtgPreflightDismissed: boolean } = {
  currentStep: 1,
  businessType: null,
  stages: [],
  platforms: makeDefaultPlatforms(),
  implementationFormat: 'gtm',
  stageTiming: {},
  transportRoutes: {},
  gtgPreflightDismissed: false,
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
    if (step === 3) return true; // Per-event routing — non-blocking
    if (step === 4) return true; // GTG pre-flight — non-blocking
    if (step === 5) {
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

  updateStageProxyValue(stageId, value) {
    set({ stages: get().stages.map((s) => (s.id === stageId ? { ...s, proxyValueGbp: value } : s)) });
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

  // ── Signal timing ────────────────────────────────────────────────────────────

  setStageJourneyDuration(stageId, duration) {
    const timing = buildTimingResult(duration);
    set({ stageTiming: { ...get().stageTiming, [stageId]: timing } });
  },

  addProxyStage(parentStageId, proxyActionKey, proxyLabel, duration) {
    const { stages, stageTiming } = get();
    const parent = stages.find((s) => s.id === parentStageId);
    if (!parent) return;

    const proxyId = generateId();
    const proxyStage: WizardStage = {
      id: proxyId,
      order: parent.order + 0.5, // will be normalised on reorder
      label: proxyLabel,
      pageType: 'custom',
      sampleUrl: '',
      actions: [proxyActionKey],
    };

    const updated = [...stages, proxyStage]
      .sort((a, b) => a.order - b.order)
      .map((s, i) => ({ ...s, order: i + 1 }));

    const proxyTiming = buildTimingResult(duration, true, parentStageId);

    set({
      stages: updated,
      stageTiming: { ...stageTiming, [proxyId]: proxyTiming },
    });
  },

  removeProxyStage(stageId) {
    const { stages, stageTiming } = get();
    const filtered = stages
      .filter((s) => s.id !== stageId)
      .map((s, i) => ({ ...s, order: i + 1 }));

    const { [stageId]: _removed, ...remainingTiming } = stageTiming;
    set({ stages: filtered, stageTiming: remainingTiming });
  },

  setTransportRoute(stageId, route) {
    set({ transportRoutes: { ...get().transportRoutes, [stageId]: route } });
  },

  setGtgPreflightDismissed(v) {
    set({ gtgPreflightDismissed: v });
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
      stageTiming: {},
      currentStep: 2,
    });
  },

  reset() {
    set({ ...INITIAL_STATE, platforms: makeDefaultPlatforms(), stageTiming: {}, transportRoutes: {}, gtgPreflightDismissed: false });
  },
}));
