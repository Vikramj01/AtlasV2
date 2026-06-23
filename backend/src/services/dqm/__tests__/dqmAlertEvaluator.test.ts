/**
 * DQM Alert Evaluator — unit tests
 *
 * Pure functions, no mocks needed.
 * Covers: GTG severity mapping, DMA severity mapping, dedup (update vs open),
 * and recovery (resolve) paths.
 */

import { describe, it, expect } from 'vitest';
import { evaluateGTGAlert, evaluateDMAAlert } from '../dqmAlertEvaluator';

// ── evaluateGTGAlert ──────────────────────────────────────────────────────────

describe('evaluateGTGAlert', () => {
  describe('no existing alert', () => {
    it('fail → open critical', () => {
      const r = evaluateGTGAlert({ status: 'fail', existingAlertActive: false });
      expect(r.decision).toBe('open');
      expect(r.severity).toBe('critical');
    });

    it('timeout → open critical', () => {
      const r = evaluateGTGAlert({ status: 'timeout', existingAlertActive: false });
      expect(r.decision).toBe('open');
      expect(r.severity).toBe('critical');
    });

    it('degraded → open warning', () => {
      const r = evaluateGTGAlert({ status: 'degraded', existingAlertActive: false });
      expect(r.decision).toBe('open');
      expect(r.severity).toBe('warning');
    });

    it('pass → none (nothing to open)', () => {
      const r = evaluateGTGAlert({ status: 'pass', existingAlertActive: false });
      expect(r.decision).toBe('none');
      expect(r.severity).toBeNull();
    });

    it('error (no GTM connection) → none', () => {
      const r = evaluateGTGAlert({ status: 'error', existingAlertActive: false });
      expect(r.decision).toBe('none');
    });

    it('skipped-backoff → none (never alerts)', () => {
      const r = evaluateGTGAlert({ status: 'skipped-backoff', existingAlertActive: false });
      expect(r.decision).toBe('none');
    });
  });

  describe('existing alert active (dedup)', () => {
    it('fail with existing alert → update, not open', () => {
      const r = evaluateGTGAlert({ status: 'fail', existingAlertActive: true });
      expect(r.decision).toBe('update');
      expect(r.severity).toBe('critical');
    });

    it('degraded with existing alert → update warning', () => {
      const r = evaluateGTGAlert({ status: 'degraded', existingAlertActive: true });
      expect(r.decision).toBe('update');
      expect(r.severity).toBe('warning');
    });

    it('pass with existing alert → resolve (recovery)', () => {
      const r = evaluateGTGAlert({ status: 'pass', existingAlertActive: true });
      expect(r.decision).toBe('resolve');
      expect(r.severity).toBeNull();
    });

    it('skipped-backoff with existing alert → none (backoff does not clear or update)', () => {
      const r = evaluateGTGAlert({ status: 'skipped-backoff', existingAlertActive: true });
      expect(r.decision).toBe('none');
    });
  });
});

// ── evaluateDMAAlert ──────────────────────────────────────────────────────────

const BASE_DMA = {
  uploadSuccessRate: 80,
  avgMatchRate: 65,
  prevAvgMatchRate: 68,
  totalMembers30d: 5000,
  hadActivityBefore: true,
  matchRateWarningThreshold: 0.50,
  matchRateDropThreshold: 0.10,
  existingAlertActive: false,
};

describe('evaluateDMAAlert', () => {
  describe('no existing alert', () => {
    it('healthy metrics → none', () => {
      const r = evaluateDMAAlert(BASE_DMA);
      expect(r.decision).toBe('none');
    });

    it('upload stopped after previous activity → open critical', () => {
      const r = evaluateDMAAlert({
        ...BASE_DMA,
        uploadSuccessRate: 0,
        totalMembers30d: 0,
        hadActivityBefore: true,
      });
      expect(r.decision).toBe('open');
      expect(r.severity).toBe('critical');
    });

    it('upload stopped but no prior activity → not critical', () => {
      const r = evaluateDMAAlert({
        ...BASE_DMA,
        uploadSuccessRate: 0,
        totalMembers30d: 0,
        hadActivityBefore: false,
      });
      expect(r.decision).toBe('none');
    });

    it('match rate below absolute floor (50%) → open warning', () => {
      const r = evaluateDMAAlert({ ...BASE_DMA, avgMatchRate: 45 });
      expect(r.decision).toBe('open');
      expect(r.severity).toBe('warning');
    });

    it('match rate exactly at floor → none (not below)', () => {
      // Override prevAvgMatchRate to avoid triggering the drop check
      const r = evaluateDMAAlert({ ...BASE_DMA, avgMatchRate: 50, prevAvgMatchRate: 50 });
      expect(r.decision).toBe('none');
    });

    it('match rate dropped >10pp vs previous → open warning', () => {
      // prev=80, current=65 → drop=18.75% which is >10%
      const r = evaluateDMAAlert({ ...BASE_DMA, avgMatchRate: 65, prevAvgMatchRate: 80 });
      expect(r.decision).toBe('open');
      expect(r.severity).toBe('warning');
    });

    it('match rate dropped <10pp vs previous → none', () => {
      // prev=70, current=65 → drop=7.1% which is <10%
      const r = evaluateDMAAlert({ ...BASE_DMA, avgMatchRate: 65, prevAvgMatchRate: 70 });
      expect(r.decision).toBe('none');
    });

    it('no previous match rate → no drop alert', () => {
      const r = evaluateDMAAlert({ ...BASE_DMA, avgMatchRate: 65, prevAvgMatchRate: null });
      expect(r.decision).toBe('none');
    });

    it('null current match rate → no floor or drop alert', () => {
      const r = evaluateDMAAlert({ ...BASE_DMA, avgMatchRate: null });
      expect(r.decision).toBe('none');
    });
  });

  describe('existing alert active (dedup)', () => {
    it('persisting match rate issue → update, not open', () => {
      const r = evaluateDMAAlert({
        ...BASE_DMA,
        avgMatchRate: 40,
        existingAlertActive: true,
      });
      expect(r.decision).toBe('update');
      expect(r.severity).toBe('warning');
    });

    it('upload stopped, existing alert → update critical', () => {
      const r = evaluateDMAAlert({
        ...BASE_DMA,
        uploadSuccessRate: 0,
        totalMembers30d: 0,
        hadActivityBefore: true,
        existingAlertActive: true,
      });
      expect(r.decision).toBe('update');
      expect(r.severity).toBe('critical');
    });
  });

  describe('recovery', () => {
    it('healthy metrics with active alert → resolve', () => {
      const r = evaluateDMAAlert({ ...BASE_DMA, existingAlertActive: true });
      expect(r.decision).toBe('resolve');
    });
  });
});
