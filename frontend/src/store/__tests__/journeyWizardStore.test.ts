/**
 * journeyWizardStore tests — Journey Builder wizard Zustand state
 *
 * Tests: setBusinessType (populates stages), stage CRUD (add/remove/update/reorder),
 *        toggleAction, canProceedFromStep validation, signal timing, proxy stages,
 *        transport routes, loadFromTemplate, reset.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useJourneyWizardStore } from '@/store/journeyWizardStore';

describe('journeyWizardStore', () => {
  beforeEach(() => {
    useJourneyWizardStore.getState().reset();
  });

  // ── Initial state ─────────────────────────────────────────────────────────────

  it('starts at step 1 with no business type', () => {
    const state = useJourneyWizardStore.getState();
    expect(state.currentStep).toBe(1);
    expect(state.businessType).toBeNull();
    expect(state.stages).toHaveLength(0);
  });

  // ── setBusinessType ───────────────────────────────────────────────────────────

  describe('setBusinessType', () => {
    it('sets the business type', () => {
      useJourneyWizardStore.getState().setBusinessType('ecommerce');
      expect(useJourneyWizardStore.getState().businessType).toBe('ecommerce');
    });

    it('populates stages from the default template', () => {
      useJourneyWizardStore.getState().setBusinessType('ecommerce');
      expect(useJourneyWizardStore.getState().stages.length).toBeGreaterThan(0);
    });

    it('replaces stages when business type is changed', () => {
      useJourneyWizardStore.getState().setBusinessType('ecommerce');
      const ecStages = useJourneyWizardStore.getState().stages.length;
      useJourneyWizardStore.getState().setBusinessType('lead_gen');
      const lgStages = useJourneyWizardStore.getState().stages.length;
      // Both should have stages (may differ)
      expect(ecStages).toBeGreaterThan(0);
      expect(lgStages).toBeGreaterThan(0);
    });

    it('assigns unique ids to all stages', () => {
      useJourneyWizardStore.getState().setBusinessType('ecommerce');
      const ids = useJourneyWizardStore.getState().stages.map((s) => s.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  // ── goToStep ──────────────────────────────────────────────────────────────────

  describe('goToStep', () => {
    it('navigates to the given step', () => {
      useJourneyWizardStore.getState().goToStep(3);
      expect(useJourneyWizardStore.getState().currentStep).toBe(3);
    });
  });

  // ── canProceedFromStep ────────────────────────────────────────────────────────

  describe('canProceedFromStep', () => {
    it('step 1 requires businessType to be set', () => {
      expect(useJourneyWizardStore.getState().canProceedFromStep(1)).toBe(false);
      useJourneyWizardStore.getState().setBusinessType('ecommerce');
      expect(useJourneyWizardStore.getState().canProceedFromStep(1)).toBe(true);
    });

    it('step 2 requires at least 2 stages', () => {
      useJourneyWizardStore.getState().setBusinessType('ecommerce');
      const stages = useJourneyWizardStore.getState().stages;
      // Remove stages until only 1 remains
      while (useJourneyWizardStore.getState().stages.length > 1) {
        const last = useJourneyWizardStore.getState().stages.at(-1)!;
        useJourneyWizardStore.getState().removeStage(last.id);
      }
      expect(useJourneyWizardStore.getState().canProceedFromStep(2)).toBe(false);
      // Restore by adding a stage
      useJourneyWizardStore.getState().addStage(1);
      // Still need an action
      expect(useJourneyWizardStore.getState().canProceedFromStep(2)).toBe(
        useJourneyWizardStore.getState().stages.some((s) => s.actions.length > 0),
      );
      void stages; // suppress unused warning
    });

    it('step 2 requires at least one stage to have an action', () => {
      useJourneyWizardStore.getState().setBusinessType('ecommerce');
      // Ecommerce stages come with actions; clear them all to test the no-action case
      for (const s of useJourneyWizardStore.getState().stages) {
        for (const a of [...s.actions]) {
          useJourneyWizardStore.getState().toggleAction(s.id, a);
        }
      }
      expect(useJourneyWizardStore.getState().canProceedFromStep(2)).toBe(false);
    });

    it('step 3 is always passable (transport routing is non-blocking)', () => {
      expect(useJourneyWizardStore.getState().canProceedFromStep(3)).toBe(true);
    });

    it('step 4 is always passable (GTG pre-flight is non-blocking)', () => {
      expect(useJourneyWizardStore.getState().canProceedFromStep(4)).toBe(true);
    });

    it('step 5 requires at least one active platform', () => {
      // Deactivate all platforms
      for (const p of useJourneyWizardStore.getState().platforms) {
        if (p.isActive) useJourneyWizardStore.getState().togglePlatform(p.platform);
      }
      expect(useJourneyWizardStore.getState().canProceedFromStep(5)).toBe(false);
      // Activate one
      const firstPlatform = useJourneyWizardStore.getState().platforms[0].platform;
      useJourneyWizardStore.getState().togglePlatform(firstPlatform);
      expect(useJourneyWizardStore.getState().canProceedFromStep(5)).toBe(true);
    });
  });

  // ── Stage CRUD ────────────────────────────────────────────────────────────────

  describe('addStage', () => {
    it('inserts a new stage after the given order and renumbers', () => {
      useJourneyWizardStore.getState().setBusinessType('ecommerce');
      const before = useJourneyWizardStore.getState().stages.length;
      useJourneyWizardStore.getState().addStage(1);
      expect(useJourneyWizardStore.getState().stages).toHaveLength(before + 1);
    });

    it('stages remain sequentially ordered after insert', () => {
      useJourneyWizardStore.getState().setBusinessType('ecommerce');
      useJourneyWizardStore.getState().addStage(1);
      const orders = useJourneyWizardStore.getState().stages.map((s) => s.order);
      orders.forEach((o, i) => expect(o).toBe(i + 1));
    });
  });

  describe('removeStage', () => {
    it('removes the stage by id', () => {
      useJourneyWizardStore.getState().setBusinessType('ecommerce');
      const stageId = useJourneyWizardStore.getState().stages[0].id;
      const before = useJourneyWizardStore.getState().stages.length;
      useJourneyWizardStore.getState().removeStage(stageId);
      expect(useJourneyWizardStore.getState().stages).toHaveLength(before - 1);
    });

    it('re-sequences orders after removal', () => {
      useJourneyWizardStore.getState().setBusinessType('ecommerce');
      const stageId = useJourneyWizardStore.getState().stages[0].id;
      useJourneyWizardStore.getState().removeStage(stageId);
      const orders = useJourneyWizardStore.getState().stages.map((s) => s.order);
      orders.forEach((o, i) => expect(o).toBe(i + 1));
    });
  });

  describe('updateStageLabel', () => {
    it('changes the label of the matching stage', () => {
      useJourneyWizardStore.getState().setBusinessType('ecommerce');
      const stageId = useJourneyWizardStore.getState().stages[0].id;
      useJourneyWizardStore.getState().updateStageLabel(stageId, 'Landing Page');
      expect(useJourneyWizardStore.getState().stages[0].label).toBe('Landing Page');
    });
  });

  describe('updateStageUrl', () => {
    it('updates sampleUrl on the matching stage', () => {
      useJourneyWizardStore.getState().setBusinessType('ecommerce');
      const stageId = useJourneyWizardStore.getState().stages[0].id;
      useJourneyWizardStore.getState().updateStageUrl(stageId, 'https://example.com/cart');
      expect(useJourneyWizardStore.getState().stages[0].sampleUrl).toBe('https://example.com/cart');
    });
  });

  describe('updateStageProxyValue', () => {
    it('sets proxyValueGbp on the matching stage', () => {
      useJourneyWizardStore.getState().setBusinessType('ecommerce');
      const stageId = useJourneyWizardStore.getState().stages[0].id;
      useJourneyWizardStore.getState().updateStageProxyValue(stageId, 25.5);
      expect(useJourneyWizardStore.getState().stages[0].proxyValueGbp).toBe(25.5);
    });

    it('clears proxyValueGbp when set to undefined', () => {
      useJourneyWizardStore.getState().setBusinessType('ecommerce');
      const stageId = useJourneyWizardStore.getState().stages[0].id;
      useJourneyWizardStore.getState().updateStageProxyValue(stageId, 100);
      useJourneyWizardStore.getState().updateStageProxyValue(stageId, undefined);
      expect(useJourneyWizardStore.getState().stages[0].proxyValueGbp).toBeUndefined();
    });
  });

  // ── toggleAction ──────────────────────────────────────────────────────────────

  describe('toggleAction', () => {
    it('adds an action key if not present', () => {
      useJourneyWizardStore.getState().setBusinessType('ecommerce');
      const stageId = useJourneyWizardStore.getState().stages[0].id;
      // Clear all actions first
      for (const a of [...useJourneyWizardStore.getState().stages[0].actions]) {
        useJourneyWizardStore.getState().toggleAction(stageId, a);
      }
      useJourneyWizardStore.getState().toggleAction(stageId, 'view_item');
      expect(useJourneyWizardStore.getState().stages[0].actions).toContain('view_item');
    });

    it('removes an action key if already present', () => {
      useJourneyWizardStore.getState().setBusinessType('ecommerce');
      const stageId = useJourneyWizardStore.getState().stages[0].id;
      useJourneyWizardStore.getState().toggleAction(stageId, 'view_item');
      useJourneyWizardStore.getState().toggleAction(stageId, 'view_item');
      expect(useJourneyWizardStore.getState().stages[0].actions).not.toContain('view_item');
    });
  });

  // ── reorderStages ─────────────────────────────────────────────────────────────

  describe('reorderStages', () => {
    it('applies the new order based on array index', () => {
      useJourneyWizardStore.getState().setBusinessType('ecommerce');
      const stages = [...useJourneyWizardStore.getState().stages];
      const reversed = [...stages].reverse();
      useJourneyWizardStore.getState().reorderStages(reversed);
      const newOrders = useJourneyWizardStore.getState().stages.map((s) => s.order);
      newOrders.forEach((o, i) => expect(o).toBe(i + 1));
    });
  });

  // ── Signal timing ─────────────────────────────────────────────────────────────

  describe('setStageJourneyDuration', () => {
    it('records timing result in stageTiming keyed by stage id', () => {
      useJourneyWizardStore.getState().setBusinessType('ecommerce');
      const stageId = useJourneyWizardStore.getState().stages[0].id;
      useJourneyWizardStore.getState().setStageJourneyDuration(stageId, 'immediate');
      const timing = useJourneyWizardStore.getState().stageTiming[stageId];
      expect(timing).toBeDefined();
      expect(timing.lag_class).toBe('immediate');
      expect(timing.is_proxy).toBe(false);
    });
  });

  // ── Proxy stages ──────────────────────────────────────────────────────────────

  describe('addProxyStage / removeProxyStage', () => {
    it('addProxyStage inserts a new stage and sets its timing', () => {
      useJourneyWizardStore.getState().setBusinessType('ecommerce');
      const parentId = useJourneyWizardStore.getState().stages[0].id;
      const before = useJourneyWizardStore.getState().stages.length;
      useJourneyWizardStore.getState().addProxyStage(parentId, 'view_item', 'Page View', 'one_to_seven_days');
      expect(useJourneyWizardStore.getState().stages).toHaveLength(before + 1);
    });

    it('addProxyStage sets is_proxy=true on the new stage timing', () => {
      useJourneyWizardStore.getState().setBusinessType('ecommerce');
      const parentId = useJourneyWizardStore.getState().stages[0].id;
      useJourneyWizardStore.getState().addProxyStage(parentId, 'view_item', 'Page View', 'immediate');
      const allTimings = useJourneyWizardStore.getState().stageTiming;
      const proxyTimings = Object.values(allTimings).filter((t) => t.is_proxy);
      expect(proxyTimings).toHaveLength(1);
      expect(proxyTimings[0].proxy_for).toBe(parentId);
    });

    it('removeProxyStage removes the stage and its timing entry', () => {
      useJourneyWizardStore.getState().setBusinessType('ecommerce');
      const parentId = useJourneyWizardStore.getState().stages[0].id;
      useJourneyWizardStore.getState().addProxyStage(parentId, 'view_item', 'Page View', 'immediate');
      const stages = useJourneyWizardStore.getState().stages;
      const proxyStage = stages.find(
        (s) => useJourneyWizardStore.getState().stageTiming[s.id]?.is_proxy,
      )!;
      useJourneyWizardStore.getState().removeProxyStage(proxyStage.id);
      expect(useJourneyWizardStore.getState().stageTiming[proxyStage.id]).toBeUndefined();
    });
  });

  // ── Transport routes ──────────────────────────────────────────────────────────

  describe('setTransportRoute', () => {
    it('sets the transport route for a stage', () => {
      useJourneyWizardStore.getState().setBusinessType('ecommerce');
      const stageId = useJourneyWizardStore.getState().stages[0].id;
      useJourneyWizardStore.getState().setTransportRoute(stageId, 'dma_push');
      expect(useJourneyWizardStore.getState().transportRoutes[stageId]).toBe('dma_push');
    });
  });

  // ── Platform management ───────────────────────────────────────────────────────

  describe('togglePlatform', () => {
    it('deactivates an active platform', () => {
      const activePlatform = useJourneyWizardStore
        .getState()
        .platforms.find((p) => p.isActive)!;
      useJourneyWizardStore.getState().togglePlatform(activePlatform.platform);
      const updated = useJourneyWizardStore
        .getState()
        .platforms.find((p) => p.platform === activePlatform.platform)!;
      expect(updated.isActive).toBe(false);
    });

    it('activates an inactive platform', () => {
      const inactivePlatform = useJourneyWizardStore
        .getState()
        .platforms.find((p) => !p.isActive)!;
      if (inactivePlatform) {
        useJourneyWizardStore.getState().togglePlatform(inactivePlatform.platform);
        const updated = useJourneyWizardStore
          .getState()
          .platforms.find((p) => p.platform === inactivePlatform.platform)!;
        expect(updated.isActive).toBe(true);
      }
    });
  });

  describe('setPlatformId', () => {
    it('sets measurement id for the matching platform', () => {
      const platform = useJourneyWizardStore.getState().platforms[0].platform;
      useJourneyWizardStore.getState().setPlatformId(platform, 'G-12345');
      const updated = useJourneyWizardStore
        .getState()
        .platforms.find((p) => p.platform === platform)!;
      expect(updated.measurementId).toBe('G-12345');
    });
  });

  // ── loadFromTemplate ──────────────────────────────────────────────────────────

  describe('loadFromTemplate', () => {
    it('sets businessType, stages, and jumps to step 2', () => {
      const template = {
        business_type: 'lead_gen',
        template_data: {
          stages: [
            { order: 1, label: 'Landing', page_type: 'landing', actions: ['view_item'] },
            { order: 2, label: 'Thank You', page_type: 'confirmation', actions: ['generate_lead'] },
          ],
        },
      } as any;
      useJourneyWizardStore.getState().loadFromTemplate(template);
      const state = useJourneyWizardStore.getState();
      expect(state.businessType).toBe('lead_gen');
      expect(state.stages).toHaveLength(2);
      expect(state.currentStep).toBe(2);
    });

    it('assigns new ids to template stages (not using template stage ids)', () => {
      const template = {
        business_type: 'ecommerce',
        template_data: {
          stages: [
            { order: 1, label: 'Home', page_type: 'home', actions: [] },
          ],
        },
      } as any;
      useJourneyWizardStore.getState().loadFromTemplate(template);
      const stage = useJourneyWizardStore.getState().stages[0];
      // Should have a generated id, not undefined or empty
      expect(stage.id).toBeTruthy();
      expect(stage.id.length).toBeGreaterThan(0);
    });
  });

  // ── reset ─────────────────────────────────────────────────────────────────────

  describe('reset', () => {
    it('restores initial state', () => {
      useJourneyWizardStore.getState().setBusinessType('ecommerce');
      useJourneyWizardStore.getState().goToStep(4);
      useJourneyWizardStore.getState().reset();
      const state = useJourneyWizardStore.getState();
      expect(state.currentStep).toBe(1);
      expect(state.businessType).toBeNull();
      expect(state.stages).toHaveLength(0);
      expect(state.stageTiming).toEqual({});
      expect(state.transportRoutes).toEqual({});
    });
  });
});
