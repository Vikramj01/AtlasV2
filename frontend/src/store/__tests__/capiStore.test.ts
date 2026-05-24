/**
 * capiStore tests — CAPI module Zustand state
 *
 * Tests: wizard open/close/step/draft/providerId, provider list management,
 *        dashboard selection, reset.
 *
 * Note: capiStore has no async API calls — it's a pure state store.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useCAPIStore } from '@/store/capiStore';

describe('capiStore', () => {
  beforeEach(() => {
    useCAPIStore.getState().reset();
  });

  // ── Initial state ─────────────────────────────────────────────────────────────

  it('starts with wizard closed and no providers', () => {
    const state = useCAPIStore.getState();
    expect(state.wizardOpen).toBe(false);
    expect(state.providers).toHaveLength(0);
    expect(state.selectedProviderId).toBeNull();
  });

  // ── openWizard / closeWizard ──────────────────────────────────────────────────

  describe('openWizard', () => {
    it('sets wizardOpen to true', () => {
      useCAPIStore.getState().openWizard();
      expect(useCAPIStore.getState().wizardOpen).toBe(true);
    });

    it('resets wizard step to 1', () => {
      useCAPIStore.getState().setWizardStep(4);
      useCAPIStore.getState().openWizard();
      expect(useCAPIStore.getState().wizardStep).toBe(1);
    });

    it('sets the provider in the draft', () => {
      useCAPIStore.getState().openWizard('meta');
      expect(useCAPIStore.getState().wizardDraft.provider).toBe('meta');
    });

    it('uses meta as default provider', () => {
      useCAPIStore.getState().openWizard();
      expect(useCAPIStore.getState().wizardDraft.provider).toBe('meta');
    });

    it('clears wizardProviderId on open', () => {
      useCAPIStore.getState().setWizardProviderId('prov-old');
      useCAPIStore.getState().openWizard();
      expect(useCAPIStore.getState().wizardProviderId).toBeNull();
    });

    it('clears wizardError on open', () => {
      useCAPIStore.getState().setWizardError('previous error');
      useCAPIStore.getState().openWizard();
      expect(useCAPIStore.getState().wizardError).toBeNull();
    });
  });

  describe('closeWizard', () => {
    it('sets wizardOpen to false', () => {
      useCAPIStore.getState().openWizard();
      useCAPIStore.getState().closeWizard();
      expect(useCAPIStore.getState().wizardOpen).toBe(false);
    });
  });

  // ── Wizard step ───────────────────────────────────────────────────────────────

  describe('setWizardStep', () => {
    it('sets the wizard step', () => {
      useCAPIStore.getState().setWizardStep(3);
      expect(useCAPIStore.getState().wizardStep).toBe(3);
    });
  });

  // ── Wizard draft ──────────────────────────────────────────────────────────────

  describe('setWizardDraft', () => {
    it('patches the draft with new values', () => {
      useCAPIStore.getState().openWizard('meta');
      useCAPIStore.getState().setWizardDraft({ test_event_code: 'TEST123' });
      expect(useCAPIStore.getState().wizardDraft.test_event_code).toBe('TEST123');
      expect(useCAPIStore.getState().wizardDraft.provider).toBe('meta');
    });

    it('merges with existing draft values (does not replace)', () => {
      useCAPIStore.getState().openWizard('google');
      useCAPIStore.getState().setWizardDraft({ project_id: 'proj-001' });
      useCAPIStore.getState().setWizardDraft({ test_event_code: 'CODE' });
      expect(useCAPIStore.getState().wizardDraft.project_id).toBe('proj-001');
      expect(useCAPIStore.getState().wizardDraft.test_event_code).toBe('CODE');
    });
  });

  // ── Wizard provider id ────────────────────────────────────────────────────────

  describe('setWizardProviderId', () => {
    it('sets the provider id', () => {
      useCAPIStore.getState().setWizardProviderId('prov-001');
      expect(useCAPIStore.getState().wizardProviderId).toBe('prov-001');
    });
  });

  // ── Wizard saving / error ─────────────────────────────────────────────────────

  describe('setWizardSaving', () => {
    it('sets wizardSaving to true', () => {
      useCAPIStore.getState().setWizardSaving(true);
      expect(useCAPIStore.getState().wizardSaving).toBe(true);
    });
  });

  describe('setWizardError', () => {
    it('sets wizard error message', () => {
      useCAPIStore.getState().setWizardError('Credentials invalid');
      expect(useCAPIStore.getState().wizardError).toBe('Credentials invalid');
    });

    it('clears error when set to null', () => {
      useCAPIStore.getState().setWizardError('some error');
      useCAPIStore.getState().setWizardError(null);
      expect(useCAPIStore.getState().wizardError).toBeNull();
    });
  });

  // ── Provider list ─────────────────────────────────────────────────────────────

  describe('setProviders', () => {
    it('replaces the providers array', () => {
      const providers = [{ id: 'prov-001', provider: 'meta' }] as any;
      useCAPIStore.getState().setProviders(providers);
      expect(useCAPIStore.getState().providers).toHaveLength(1);
    });
  });

  describe('removeProvider', () => {
    it('removes the provider with the matching id', () => {
      useCAPIStore.getState().setProviders([
        { id: 'prov-001', provider: 'meta' },
        { id: 'prov-002', provider: 'google' },
      ] as any);
      useCAPIStore.getState().removeProvider('prov-001');
      expect(useCAPIStore.getState().providers).toHaveLength(1);
      expect(useCAPIStore.getState().providers[0].id).toBe('prov-002');
    });
  });

  describe('setProvidersLoading', () => {
    it('sets the loading flag', () => {
      useCAPIStore.getState().setProvidersLoading(true);
      expect(useCAPIStore.getState().providersLoading).toBe(true);
    });
  });

  describe('setProvidersError', () => {
    it('sets the providers error', () => {
      useCAPIStore.getState().setProvidersError('Failed to load');
      expect(useCAPIStore.getState().providersError).toBe('Failed to load');
    });
  });

  // ── Dashboard ─────────────────────────────────────────────────────────────────

  describe('selectProvider', () => {
    it('sets selectedProviderId', () => {
      useCAPIStore.getState().selectProvider('prov-001');
      expect(useCAPIStore.getState().selectedProviderId).toBe('prov-001');
    });

    it('clears the dashboard when selecting a new provider', () => {
      useCAPIStore.getState().setDashboard({ events: [] } as any);
      useCAPIStore.getState().selectProvider('prov-001');
      expect(useCAPIStore.getState().dashboard).toBeNull();
    });

    it('accepts null to deselect', () => {
      useCAPIStore.getState().selectProvider('prov-001');
      useCAPIStore.getState().selectProvider(null);
      expect(useCAPIStore.getState().selectedProviderId).toBeNull();
    });
  });

  describe('setDashboard', () => {
    it('sets the dashboard data', () => {
      const dashboard = { events: [{ id: 'e1' }] } as any;
      useCAPIStore.getState().setDashboard(dashboard);
      expect(useCAPIStore.getState().dashboard).toEqual(dashboard);
    });
  });

  describe('setDashboardLoading', () => {
    it('sets the dashboard loading flag', () => {
      useCAPIStore.getState().setDashboardLoading(true);
      expect(useCAPIStore.getState().dashboardLoading).toBe(true);
    });
  });

  // ── reset ─────────────────────────────────────────────────────────────────────

  describe('reset', () => {
    it('restores initial state', () => {
      useCAPIStore.getState().openWizard('meta');
      useCAPIStore.getState().setWizardStep(4);
      useCAPIStore.getState().setProviders([{ id: 'p1' }] as any);
      useCAPIStore.getState().selectProvider('p1');

      useCAPIStore.getState().reset();

      const state = useCAPIStore.getState();
      expect(state.wizardOpen).toBe(false);
      expect(state.wizardStep).toBe(1);
      expect(state.providers).toHaveLength(0);
      expect(state.selectedProviderId).toBeNull();
      expect(state.dashboard).toBeNull();
    });
  });
});
