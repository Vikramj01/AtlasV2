/**
 * strategyStore tests — Strategy Gate Zustand state
 *
 * Tests: fetchBriefs/fetchBrief (success + error paths), createBrief (prepend),
 *        lockBrief, deleteBrief, createBriefVersion, createObjective (appends),
 *        updateObjective, deleteObjective, evaluateObjective, lockObjective
 *        (objectiveLoading lifecycle), reset.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn() } },
}));

vi.mock('@/lib/api/strategyApi', () => ({
  strategyApi: {
    listBriefs: vi.fn(),
    getBrief: vi.fn(),
    createBrief: vi.fn(),
    lockBrief: vi.fn(),
    deleteBrief: vi.fn(),
    createBriefVersion: vi.fn(),
    createObjective: vi.fn(),
    updateObjective: vi.fn(),
    deleteObjective: vi.fn(),
    evaluateObjective: vi.fn(),
    lockObjective: vi.fn(),
  },
}));

import { useStrategyStore } from '@/store/strategyStore';
import { strategyApi } from '@/lib/api/strategyApi';

const BRIEF = {
  id: 'brief-001',
  brief_name: 'Q4 Acquisition',
  mode: 'single' as const,
  locked_at: null,
  superseded_by: null,
  created_at: '2026-01-01T00:00:00Z',
};

const OBJECTIVE = {
  id: 'obj-001',
  brief_id: 'brief-001',
  name: 'Drive purchases',
  verdict: null,
  locked: false,
};

const BRIEF_WITH_OBJECTIVES = { ...BRIEF, objectives: [OBJECTIVE] };

describe('strategyStore', () => {
  beforeEach(() => {
    useStrategyStore.getState().reset();
    vi.clearAllMocks();
  });

  // ── fetchBriefs ───────────────────────────────────────────────────────────────

  describe('fetchBriefs', () => {
    it('populates briefs on success', async () => {
      vi.mocked(strategyApi.listBriefs).mockResolvedValue({ data: [BRIEF] } as any);
      await useStrategyStore.getState().fetchBriefs();
      expect(useStrategyStore.getState().briefs).toHaveLength(1);
      expect(useStrategyStore.getState().briefsLoading).toBe(false);
      expect(useStrategyStore.getState().briefsError).toBeNull();
    });

    it('sets briefsError on failure', async () => {
      vi.mocked(strategyApi.listBriefs).mockRejectedValue(new Error('Network error'));
      await useStrategyStore.getState().fetchBriefs();
      expect(useStrategyStore.getState().briefs).toHaveLength(0);
      expect(useStrategyStore.getState().briefsLoading).toBe(false);
      expect(useStrategyStore.getState().briefsError).toBe('Network error');
    });

    it('sets briefsLoading to true during fetch', async () => {
      let resolve!: (v: any) => void;
      vi.mocked(strategyApi.listBriefs).mockReturnValue(new Promise((r) => { resolve = r; }));
      const p = useStrategyStore.getState().fetchBriefs();
      expect(useStrategyStore.getState().briefsLoading).toBe(true);
      resolve({ data: [] });
      await p;
      expect(useStrategyStore.getState().briefsLoading).toBe(false);
    });
  });

  // ── fetchBrief ────────────────────────────────────────────────────────────────

  describe('fetchBrief', () => {
    it('sets activeBrief on success', async () => {
      vi.mocked(strategyApi.getBrief).mockResolvedValue({ data: BRIEF_WITH_OBJECTIVES } as any);
      await useStrategyStore.getState().fetchBrief('brief-001');
      expect(useStrategyStore.getState().activeBrief?.id).toBe('brief-001');
      expect(useStrategyStore.getState().activeBriefLoading).toBe(false);
    });

    it('sets activeBriefError on failure', async () => {
      vi.mocked(strategyApi.getBrief).mockRejectedValue(new Error('Not found'));
      await useStrategyStore.getState().fetchBrief('missing');
      expect(useStrategyStore.getState().activeBrief).toBeNull();
      expect(useStrategyStore.getState().activeBriefError).toBe('Not found');
    });
  });

  // ── createBrief ───────────────────────────────────────────────────────────────

  describe('createBrief', () => {
    it('prepends new brief to the briefs list', async () => {
      vi.mocked(strategyApi.listBriefs).mockResolvedValue({ data: [BRIEF] } as any);
      await useStrategyStore.getState().fetchBriefs();

      const newBrief = { ...BRIEF, id: 'brief-002', brief_name: 'New Brief' };
      vi.mocked(strategyApi.createBrief).mockResolvedValue({ data: newBrief } as any);
      await useStrategyStore.getState().createBrief({ brief_name: 'New Brief' });

      expect(useStrategyStore.getState().briefs[0].id).toBe('brief-002');
      expect(useStrategyStore.getState().briefs).toHaveLength(2);
    });

    it('returns the new brief', async () => {
      const newBrief = { ...BRIEF, id: 'brief-003' };
      vi.mocked(strategyApi.createBrief).mockResolvedValue({ data: newBrief } as any);
      const result = await useStrategyStore.getState().createBrief({});
      expect(result.id).toBe('brief-003');
    });
  });

  // ── lockBrief ─────────────────────────────────────────────────────────────────

  describe('lockBrief', () => {
    it('updates locked_at in the briefs list', async () => {
      vi.mocked(strategyApi.listBriefs).mockResolvedValue({ data: [BRIEF] } as any);
      await useStrategyStore.getState().fetchBriefs();

      const lockedBrief = { ...BRIEF, locked_at: '2026-01-02T00:00:00Z' };
      vi.mocked(strategyApi.lockBrief).mockResolvedValue({ data: lockedBrief } as any);
      await useStrategyStore.getState().lockBrief('brief-001');

      expect(useStrategyStore.getState().briefs[0].locked_at).toBe('2026-01-02T00:00:00Z');
    });

    it('updates activeBrief.locked_at when it matches the id', async () => {
      vi.mocked(strategyApi.getBrief).mockResolvedValue({ data: BRIEF_WITH_OBJECTIVES } as any);
      await useStrategyStore.getState().fetchBrief('brief-001');

      const lockedBrief = { ...BRIEF, locked_at: '2026-01-02T00:00:00Z' };
      vi.mocked(strategyApi.lockBrief).mockResolvedValue({ data: lockedBrief } as any);
      await useStrategyStore.getState().lockBrief('brief-001');

      expect(useStrategyStore.getState().activeBrief?.locked_at).toBe('2026-01-02T00:00:00Z');
    });
  });

  // ── deleteBrief ───────────────────────────────────────────────────────────────

  describe('deleteBrief', () => {
    it('removes brief from the list', async () => {
      vi.mocked(strategyApi.listBriefs).mockResolvedValue({ data: [BRIEF] } as any);
      await useStrategyStore.getState().fetchBriefs();

      vi.mocked(strategyApi.deleteBrief).mockResolvedValue(undefined as any);
      await useStrategyStore.getState().deleteBrief('brief-001');

      expect(useStrategyStore.getState().briefs).toHaveLength(0);
    });

    it('clears activeBrief when the deleted brief is active', async () => {
      vi.mocked(strategyApi.getBrief).mockResolvedValue({ data: BRIEF_WITH_OBJECTIVES } as any);
      await useStrategyStore.getState().fetchBrief('brief-001');

      vi.mocked(strategyApi.deleteBrief).mockResolvedValue(undefined as any);
      await useStrategyStore.getState().deleteBrief('brief-001');

      expect(useStrategyStore.getState().activeBrief).toBeNull();
    });
  });

  // ── createBriefVersion ────────────────────────────────────────────────────────

  describe('createBriefVersion', () => {
    it('marks the original brief as superseded', async () => {
      vi.mocked(strategyApi.listBriefs).mockResolvedValue({ data: [BRIEF] } as any);
      await useStrategyStore.getState().fetchBriefs();

      const newVersion = { ...BRIEF, id: 'brief-002' };
      vi.mocked(strategyApi.createBriefVersion).mockResolvedValue({ data: newVersion } as any);
      await useStrategyStore.getState().createBriefVersion('brief-001');

      expect(useStrategyStore.getState().briefs[0].superseded_by).toBe('brief-002');
    });
  });

  // ── setActiveBrief ────────────────────────────────────────────────────────────

  describe('setActiveBrief', () => {
    it('sets the active brief directly', () => {
      useStrategyStore.getState().setActiveBrief(BRIEF_WITH_OBJECTIVES as any);
      expect(useStrategyStore.getState().activeBrief?.id).toBe('brief-001');
    });

    it('clears the active brief when set to null', () => {
      useStrategyStore.getState().setActiveBrief(BRIEF_WITH_OBJECTIVES as any);
      useStrategyStore.getState().setActiveBrief(null);
      expect(useStrategyStore.getState().activeBrief).toBeNull();
    });
  });

  // ── createObjective ───────────────────────────────────────────────────────────

  describe('createObjective', () => {
    it('appends objective to activeBrief.objectives', async () => {
      useStrategyStore.getState().setActiveBrief({ ...BRIEF_WITH_OBJECTIVES, objectives: [] } as any);
      vi.mocked(strategyApi.createObjective).mockResolvedValue({
        data: OBJECTIVE,
        message: null,
      } as any);
      await useStrategyStore.getState().createObjective({
        brief_id: 'brief-001',
        name: 'Drive purchases',
      });
      expect(useStrategyStore.getState().activeBrief?.objectives).toHaveLength(1);
    });

    it('returns softCapMessage from the API response', async () => {
      useStrategyStore.getState().setActiveBrief({ ...BRIEF_WITH_OBJECTIVES, objectives: [] } as any);
      vi.mocked(strategyApi.createObjective).mockResolvedValue({
        data: OBJECTIVE,
        message: 'Soft cap reached',
      } as any);
      const result = await useStrategyStore.getState().createObjective({
        brief_id: 'brief-001',
        name: 'Drive purchases',
      });
      expect(result.softCapMessage).toBe('Soft cap reached');
    });
  });

  // ── updateObjective ───────────────────────────────────────────────────────────

  describe('updateObjective', () => {
    it('replaces the matching objective in activeBrief', async () => {
      useStrategyStore.getState().setActiveBrief(BRIEF_WITH_OBJECTIVES as any);
      const updated = { ...OBJECTIVE, name: 'Updated name' };
      vi.mocked(strategyApi.updateObjective).mockResolvedValue({ data: updated } as any);
      await useStrategyStore.getState().updateObjective('obj-001', { name: 'Updated name' });
      expect(useStrategyStore.getState().activeBrief?.objectives[0].name).toBe('Updated name');
    });

    it('clears objectiveLoading after update', async () => {
      useStrategyStore.getState().setActiveBrief(BRIEF_WITH_OBJECTIVES as any);
      vi.mocked(strategyApi.updateObjective).mockResolvedValue({ data: OBJECTIVE } as any);
      await useStrategyStore.getState().updateObjective('obj-001', {});
      expect(useStrategyStore.getState().objectiveLoading['obj-001']).toBe(false);
    });

    it('clears objectiveLoading on error and re-throws', async () => {
      useStrategyStore.getState().setActiveBrief(BRIEF_WITH_OBJECTIVES as any);
      vi.mocked(strategyApi.updateObjective).mockRejectedValue(new Error('Server error'));
      await expect(
        useStrategyStore.getState().updateObjective('obj-001', {}),
      ).rejects.toThrow('Server error');
      expect(useStrategyStore.getState().objectiveLoading['obj-001']).toBe(false);
    });
  });

  // ── deleteObjective ───────────────────────────────────────────────────────────

  describe('deleteObjective', () => {
    it('removes the objective from activeBrief', async () => {
      useStrategyStore.getState().setActiveBrief(BRIEF_WITH_OBJECTIVES as any);
      vi.mocked(strategyApi.deleteObjective).mockResolvedValue(undefined as any);
      await useStrategyStore.getState().deleteObjective('obj-001');
      expect(useStrategyStore.getState().activeBrief?.objectives).toHaveLength(0);
    });
  });

  // ── evaluateObjective ─────────────────────────────────────────────────────────

  describe('evaluateObjective', () => {
    it('replaces the objective with evaluated result', async () => {
      useStrategyStore.getState().setActiveBrief(BRIEF_WITH_OBJECTIVES as any);
      const evaluated = { ...OBJECTIVE, verdict: 'REPLACE' };
      vi.mocked(strategyApi.evaluateObjective).mockResolvedValue({
        data: { objective: evaluated },
      } as any);
      await useStrategyStore.getState().evaluateObjective('obj-001');
      expect(useStrategyStore.getState().activeBrief?.objectives[0].verdict).toBe('REPLACE');
    });

    it('toggles objectiveLoading during evaluation', async () => {
      useStrategyStore.getState().setActiveBrief(BRIEF_WITH_OBJECTIVES as any);
      let resolve!: (v: any) => void;
      vi.mocked(strategyApi.evaluateObjective).mockReturnValue(new Promise((r) => { resolve = r; }));
      const p = useStrategyStore.getState().evaluateObjective('obj-001');
      expect(useStrategyStore.getState().objectiveLoading['obj-001']).toBe(true);
      resolve({ data: { objective: OBJECTIVE } });
      await p;
      expect(useStrategyStore.getState().objectiveLoading['obj-001']).toBe(false);
    });
  });

  // ── lockObjective ─────────────────────────────────────────────────────────────

  describe('lockObjective', () => {
    it('replaces the objective with the locked version', async () => {
      useStrategyStore.getState().setActiveBrief(BRIEF_WITH_OBJECTIVES as any);
      const locked = { ...OBJECTIVE, locked: true };
      vi.mocked(strategyApi.lockObjective).mockResolvedValue({ data: locked } as any);
      await useStrategyStore.getState().lockObjective('obj-001');
      expect(useStrategyStore.getState().activeBrief?.objectives[0].locked).toBe(true);
    });
  });

  // ── reset ─────────────────────────────────────────────────────────────────────

  describe('reset', () => {
    it('restores initial state', async () => {
      vi.mocked(strategyApi.listBriefs).mockResolvedValue({ data: [BRIEF] } as any);
      await useStrategyStore.getState().fetchBriefs();
      useStrategyStore.getState().setActiveBrief(BRIEF_WITH_OBJECTIVES as any);
      useStrategyStore.getState().reset();
      const state = useStrategyStore.getState();
      expect(state.briefs).toHaveLength(0);
      expect(state.activeBrief).toBeNull();
      expect(state.briefsError).toBeNull();
      expect(state.objectiveLoading).toEqual({});
    });
  });
});
