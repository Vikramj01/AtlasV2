/**
 * planningStore tests — AI Planning wizard Zustand state
 *
 * Tests: step navigation (setStep, nextStep, prevStep, clamping),
 *        draft setup, session state mutations, page/rec/output updates,
 *        runDetection (success + failure), clearDetection, reset.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn() } },
}));

vi.mock('@/lib/api/planningApi', () => ({
  planningApi: { detectSite: vi.fn() },
}));

import { usePlanningStore } from '@/store/planningStore';
import { planningApi } from '@/lib/api/planningApi';

describe('planningStore', () => {
  beforeEach(() => {
    usePlanningStore.getState().reset();
    vi.clearAllMocks();
  });

  // ── Step navigation ──────────────────────────────────────────────────────────

  describe('setStep', () => {
    it('sets the current step to the given value', () => {
      usePlanningStore.getState().setStep(4);
      expect(usePlanningStore.getState().currentStep).toBe(4);
    });
  });

  describe('nextStep', () => {
    it('increments step by 1', () => {
      usePlanningStore.getState().setStep(3);
      usePlanningStore.getState().nextStep();
      expect(usePlanningStore.getState().currentStep).toBe(4);
    });

    it('clamps at maximum step 8', () => {
      usePlanningStore.getState().setStep(8);
      usePlanningStore.getState().nextStep();
      expect(usePlanningStore.getState().currentStep).toBe(8);
    });
  });

  describe('prevStep', () => {
    it('decrements step by 1', () => {
      usePlanningStore.getState().setStep(5);
      usePlanningStore.getState().prevStep();
      expect(usePlanningStore.getState().currentStep).toBe(4);
    });

    it('clamps at minimum step 1', () => {
      usePlanningStore.getState().setStep(1);
      usePlanningStore.getState().prevStep();
      expect(usePlanningStore.getState().currentStep).toBe(1);
    });
  });

  // ── Draft setup ──────────────────────────────────────────────────────────────

  describe('updateDraftSetup', () => {
    it('merges new fields into existing draft', () => {
      usePlanningStore.getState().updateDraftSetup({ website_url: 'https://example.com' });
      usePlanningStore.getState().updateDraftSetup({ business_type: 'ecommerce' });
      const { draftSetup } = usePlanningStore.getState();
      expect(draftSetup.website_url).toBe('https://example.com');
      expect(draftSetup.business_type).toBe('ecommerce');
    });

    it('preserves existing draft fields when merging', () => {
      usePlanningStore.getState().updateDraftSetup({ website_url: 'https://example.com' });
      usePlanningStore.getState().updateDraftSetup({ business_type: 'saas' });
      expect(usePlanningStore.getState().draftSetup.website_url).toBe('https://example.com');
    });
  });

  describe('clearDraft', () => {
    it('resets draftSetup to empty object', () => {
      usePlanningStore.getState().updateDraftSetup({ website_url: 'https://example.com' });
      usePlanningStore.getState().clearDraft();
      expect(usePlanningStore.getState().draftSetup).toEqual({});
    });
  });

  // ── Session state ─────────────────────────────────────────────────────────────

  describe('setCurrentSession', () => {
    it('stores the session object', () => {
      const session = { id: 'sess-001', status: 'pending' } as any;
      usePlanningStore.getState().setCurrentSession(session);
      expect(usePlanningStore.getState().currentSession?.id).toBe('sess-001');
    });
  });

  describe('updateSessionStatus', () => {
    it('updates status on an existing session', () => {
      usePlanningStore.getState().setCurrentSession({ id: 'sess-001', status: 'pending' } as any);
      usePlanningStore.getState().updateSessionStatus('scanning');
      expect(usePlanningStore.getState().currentSession?.status).toBe('scanning');
    });

    it('is a no-op when currentSession is null', () => {
      expect(() => usePlanningStore.getState().updateSessionStatus('scanning')).not.toThrow();
      expect(usePlanningStore.getState().currentSession).toBeNull();
    });

    it('sets error when provided', () => {
      usePlanningStore.getState().setCurrentSession({ id: 'sess-001', status: 'pending' } as any);
      usePlanningStore.getState().updateSessionStatus('failed', 'scan timed out');
      expect(usePlanningStore.getState().error).toBe('scan timed out');
    });
  });

  // ── Pages ─────────────────────────────────────────────────────────────────────

  describe('setPages / updatePage', () => {
    it('replaces the pages array', () => {
      usePlanningStore.getState().setPages([{ id: 'p1' }, { id: 'p2' }] as any);
      expect(usePlanningStore.getState().pages).toHaveLength(2);
    });

    it('updates only the matching page by id', () => {
      usePlanningStore.getState().setPages([
        { id: 'p1', status: 'pending' as const },
        { id: 'p2', status: 'pending' as const },
      ] as any);
      usePlanningStore.getState().updatePage('p1', { status: 'done' as const });
      expect(usePlanningStore.getState().pages[0].status).toBe('done');
      expect(usePlanningStore.getState().pages[1].status).toBe('pending');
    });
  });

  // ── Recommendations ───────────────────────────────────────────────────────────

  describe('setRecommendations / updateRecommendation', () => {
    it('replaces the recommendations array', () => {
      usePlanningStore.getState().setRecommendations([{ id: 'r1' }, { id: 'r2' }] as any);
      expect(usePlanningStore.getState().recommendations).toHaveLength(2);
    });

    it('updates only the matching recommendation by id', () => {
      usePlanningStore.getState().setRecommendations([
        { id: 'r1', user_decision: null },
        { id: 'r2', user_decision: null },
      ] as any);
      usePlanningStore.getState().updateRecommendation('r1', { user_decision: 'approved' });
      expect(usePlanningStore.getState().recommendations[0].user_decision).toBe('approved');
      expect(usePlanningStore.getState().recommendations[1].user_decision).toBeNull();
    });
  });

  // ── Outputs ───────────────────────────────────────────────────────────────────

  describe('setOutputs', () => {
    it('replaces the outputs array', () => {
      usePlanningStore.getState().setOutputs([{ id: 'o1', output_type: 'gtm' }] as any);
      expect(usePlanningStore.getState().outputs).toHaveLength(1);
    });
  });

  // ── Loading and error flags ───────────────────────────────────────────────────

  describe('setLoading', () => {
    it('sets isLoading to true', () => {
      usePlanningStore.getState().setLoading(true);
      expect(usePlanningStore.getState().isLoading).toBe(true);
    });

    it('sets isLoading to false', () => {
      usePlanningStore.getState().setLoading(true);
      usePlanningStore.getState().setLoading(false);
      expect(usePlanningStore.getState().isLoading).toBe(false);
    });
  });

  describe('setError', () => {
    it('sets error message', () => {
      usePlanningStore.getState().setError('something failed');
      expect(usePlanningStore.getState().error).toBe('something failed');
    });

    it('clears error when null', () => {
      usePlanningStore.getState().setError('err');
      usePlanningStore.getState().setError(null);
      expect(usePlanningStore.getState().error).toBeNull();
    });
  });

  // ── runDetection ──────────────────────────────────────────────────────────────

  describe('runDetection', () => {
    it('populates siteDetection on success', async () => {
      const detection = { platform: 'shopify', cms: 'shopify' } as any;
      vi.mocked(planningApi.detectSite).mockResolvedValue(detection);

      await usePlanningStore.getState().runDetection('https://example.com');

      expect(usePlanningStore.getState().siteDetection).toEqual(detection);
      expect(usePlanningStore.getState().detectionLoading).toBe(false);
      expect(usePlanningStore.getState().detectionError).toBeNull();
    });

    it('sets detectionError on failure', async () => {
      vi.mocked(planningApi.detectSite).mockRejectedValue(new Error('Timeout'));

      await usePlanningStore.getState().runDetection('https://broken.com');

      expect(usePlanningStore.getState().siteDetection).toBeNull();
      expect(usePlanningStore.getState().detectionLoading).toBe(false);
      expect(usePlanningStore.getState().detectionError).toBe('Timeout');
    });

    it('sets detectionLoading to true while in flight', async () => {
      let resolveDetection!: (val: any) => void;
      vi.mocked(planningApi.detectSite).mockReturnValue(
        new Promise((res) => { resolveDetection = res; }),
      );

      const detectPromise = usePlanningStore.getState().runDetection('https://example.com');
      expect(usePlanningStore.getState().detectionLoading).toBe(true);
      resolveDetection({ platform: 'custom' });
      await detectPromise;
      expect(usePlanningStore.getState().detectionLoading).toBe(false);
    });
  });

  // ── clearDetection ────────────────────────────────────────────────────────────

  describe('clearDetection', () => {
    it('clears siteDetection and error', async () => {
      vi.mocked(planningApi.detectSite).mockResolvedValue({ platform: 'shopify' } as any);
      await usePlanningStore.getState().runDetection('https://example.com');
      usePlanningStore.getState().clearDetection();
      expect(usePlanningStore.getState().siteDetection).toBeNull();
      expect(usePlanningStore.getState().detectionError).toBeNull();
      expect(usePlanningStore.getState().detectionLoading).toBe(false);
    });
  });

  // ── setConsentConfigId ────────────────────────────────────────────────────────

  describe('setConsentConfigId', () => {
    it('stores the consent config id', () => {
      usePlanningStore.getState().setConsentConfigId('cc-001');
      expect(usePlanningStore.getState().consentConfigId).toBe('cc-001');
    });

    it('clears it when set to null', () => {
      usePlanningStore.getState().setConsentConfigId('cc-001');
      usePlanningStore.getState().setConsentConfigId(null);
      expect(usePlanningStore.getState().consentConfigId).toBeNull();
    });
  });

  // ── reset ─────────────────────────────────────────────────────────────────────

  describe('reset', () => {
    it('restores initial state completely', () => {
      usePlanningStore.getState().setStep(6);
      usePlanningStore.getState().setLoading(true);
      usePlanningStore.getState().setCurrentSession({ id: 'sess-001' } as any);
      usePlanningStore.getState().setPages([{ id: 'p1' }] as any);
      usePlanningStore.getState().setError('oops');

      usePlanningStore.getState().reset();

      const state = usePlanningStore.getState();
      expect(state.currentStep).toBe(1);
      expect(state.isLoading).toBe(false);
      expect(state.currentSession).toBeNull();
      expect(state.pages).toHaveLength(0);
      expect(state.error).toBeNull();
      expect(state.draftSetup).toEqual({});
    });
  });
});
