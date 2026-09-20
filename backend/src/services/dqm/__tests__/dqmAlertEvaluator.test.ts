/**
 * DQM Alert Evaluator — unit tests
 *
 * Pure functions, no mocks needed.
 * Covers: GTG severity mapping, DMA severity mapping, dedup (update vs open),
 * and recovery (resolve) paths.
 */

import { describe, it, expect } from 'vitest';
import { evaluateGTGAlert, evaluateDMAAlert, evaluateSgtmAlert, evaluateGoogleDeliveryAlert, evaluateOutcomeSyncAlert } from '../dqmAlertEvaluator';
import type { OutcomeSyncAlertInput } from '../dqmAlertEvaluator';

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

// ── evaluateSgtmAlert ─────────────────────────────────────────────────────────

describe('evaluateSgtmAlert', () => {
  describe('no verified endpoints', () => {
    it('totalCount 0, no existing alert → none', () => {
      const r = evaluateSgtmAlert({ worstStatus: 'pass', failingCount: 0, totalCount: 0, existingAlertActive: false });
      expect(r.decision).toBe('none');
    });

    it('totalCount 0, existing alert active → resolve (last verified endpoint removed)', () => {
      const r = evaluateSgtmAlert({ worstStatus: 'pass', failingCount: 0, totalCount: 0, existingAlertActive: true });
      expect(r.decision).toBe('resolve');
    });
  });

  describe('no existing alert', () => {
    it('fail → open critical', () => {
      const r = evaluateSgtmAlert({ worstStatus: 'fail', failingCount: 1, totalCount: 2, existingAlertActive: false });
      expect(r.decision).toBe('open');
      expect(r.severity).toBe('critical');
    });

    it('timeout → open critical', () => {
      const r = evaluateSgtmAlert({ worstStatus: 'timeout', failingCount: 1, totalCount: 1, existingAlertActive: false });
      expect(r.decision).toBe('open');
      expect(r.severity).toBe('critical');
    });

    it('degraded → open warning', () => {
      const r = evaluateSgtmAlert({ worstStatus: 'degraded', failingCount: 1, totalCount: 2, existingAlertActive: false });
      expect(r.decision).toBe('open');
      expect(r.severity).toBe('warning');
    });

    it('pass → none (nothing to open)', () => {
      const r = evaluateSgtmAlert({ worstStatus: 'pass', failingCount: 0, totalCount: 2, existingAlertActive: false });
      expect(r.decision).toBe('none');
    });
  });

  describe('existing alert active (dedup)', () => {
    it('fail with existing alert → update, not open', () => {
      const r = evaluateSgtmAlert({ worstStatus: 'fail', failingCount: 1, totalCount: 2, existingAlertActive: true });
      expect(r.decision).toBe('update');
      expect(r.severity).toBe('critical');
    });

    it('degraded with existing alert → update warning', () => {
      const r = evaluateSgtmAlert({ worstStatus: 'degraded', failingCount: 1, totalCount: 2, existingAlertActive: true });
      expect(r.decision).toBe('update');
      expect(r.severity).toBe('warning');
    });

    it('pass with existing alert → resolve (recovery)', () => {
      const r = evaluateSgtmAlert({ worstStatus: 'pass', failingCount: 0, totalCount: 2, existingAlertActive: true });
      expect(r.decision).toBe('resolve');
      expect(r.severity).toBeNull();
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

// ── evaluateGoogleDeliveryAlert ────────────────────────────────────────────────

describe('evaluateGoogleDeliveryAlert', () => {
  it('confirmed_failed, no existing alert → open critical', () => {
    const r = evaluateGoogleDeliveryAlert({
      outcome: 'confirmed_failed',
      reasons: ['PROCESSING_ERROR_REASON_INVALID_GCLID'],
      existingAlertActive: false,
    });
    expect(r.decision).toBe('open');
    expect(r.severity).toBe('critical');
    expect(r.message).toContain('PROCESSING_ERROR_REASON_INVALID_GCLID');
  });

  it('confirmed_failed, existing alert → update critical', () => {
    const r = evaluateGoogleDeliveryAlert({
      outcome: 'confirmed_failed',
      reasons: [],
      existingAlertActive: true,
    });
    expect(r.decision).toBe('update');
    expect(r.severity).toBe('critical');
  });

  it('confirmed_partial, no existing alert → open warning', () => {
    const r = evaluateGoogleDeliveryAlert({
      outcome: 'confirmed_partial',
      reasons: ['PROCESSING_WARNING_REASON_INTERNAL_ERROR'],
      existingAlertActive: false,
    });
    expect(r.decision).toBe('open');
    expect(r.severity).toBe('warning');
  });

  it('confirmed_success, no existing alert → none', () => {
    const r = evaluateGoogleDeliveryAlert({
      outcome: 'confirmed_success',
      reasons: [],
      existingAlertActive: false,
    });
    expect(r.decision).toBe('none');
  });

  it('confirmed_success, existing alert → resolve', () => {
    const r = evaluateGoogleDeliveryAlert({
      outcome: 'confirmed_success',
      reasons: [],
      existingAlertActive: true,
    });
    expect(r.decision).toBe('resolve');
  });

  it('poll_exhausted → none, regardless of existing alert state (ambiguity is never evidence of failure)', () => {
    const r1 = evaluateGoogleDeliveryAlert({ outcome: 'poll_exhausted', reasons: [], existingAlertActive: false });
    const r2 = evaluateGoogleDeliveryAlert({ outcome: 'poll_exhausted', reasons: [], existingAlertActive: true });
    expect(r1.decision).toBe('none');
    expect(r2.decision).toBe('none');
  });
});

// ── evaluateOutcomeSyncAlert (CRM Outcome Integration Sprint 8, §10) ────────────────

describe('evaluateOutcomeSyncAlert', () => {
  function healthyInput(overrides: Partial<OutcomeSyncAlertInput> = {}): OutcomeSyncAlertInput {
    return {
      consecutiveFailures: 0,
      tokenExpired: false,
      unresolvedIdentityRate7d: 5,
      skippedWindowRate7d: 2,
      derivedWithheldForBiddingPrimaryStage: false,
      existingAlertActive: false,
      ...overrides,
    };
  }

  it('an entirely healthy input → none', () => {
    const r = evaluateOutcomeSyncAlert(healthyInput());
    expect(r.decision).toBe('none');
  });

  it('token expired → open critical, taking priority over every other condition', () => {
    const r = evaluateOutcomeSyncAlert(healthyInput({
      tokenExpired: true,
      consecutiveFailures: 5,
      unresolvedIdentityRate7d: 90,
    }));
    expect(r.decision).toBe('open');
    expect(r.severity).toBe('critical');
    expect(r.title).toBe('CRM Connection Expired');
  });

  it('2 consecutive failures → open critical', () => {
    const r = evaluateOutcomeSyncAlert(healthyInput({ consecutiveFailures: 2 }));
    expect(r.decision).toBe('open');
    expect(r.severity).toBe('critical');
    expect(r.title).toBe('CRM Sync Failing');
  });

  it('1 consecutive failure (below the threshold) → does not fire on its own', () => {
    const r = evaluateOutcomeSyncAlert(healthyInput({ consecutiveFailures: 1 }));
    expect(r.decision).toBe('none');
  });

  it('unresolved identity rate > 30% → open critical', () => {
    const r = evaluateOutcomeSyncAlert(healthyInput({ unresolvedIdentityRate7d: 31 }));
    expect(r.decision).toBe('open');
    expect(r.severity).toBe('critical');
    expect(r.title).toBe('CRM Identity Resolution Failing');
  });

  it('unresolved identity rate in [10, 30] → open warning', () => {
    const r = evaluateOutcomeSyncAlert(healthyInput({ unresolvedIdentityRate7d: 10 }));
    expect(r.decision).toBe('open');
    expect(r.severity).toBe('warning');
    expect(r.title).toBe('CRM Identity Resolution Degraded');
  });

  it('unresolved identity rate below 10% → does not fire', () => {
    const r = evaluateOutcomeSyncAlert(healthyInput({ unresolvedIdentityRate7d: 9.9 }));
    expect(r.decision).toBe('none');
  });

  it('null unresolved identity rate (no data) never fires that condition', () => {
    const r = evaluateOutcomeSyncAlert(healthyInput({ unresolvedIdentityRate7d: null }));
    expect(r.decision).toBe('none');
  });

  it('skipped_window rate > 10% → open warning', () => {
    const r = evaluateOutcomeSyncAlert(healthyInput({ skippedWindowRate7d: 10.1 }));
    expect(r.decision).toBe('open');
    expect(r.severity).toBe('warning');
    expect(r.title).toBe('CRM Outcomes Missing Ingest Windows');
  });

  it('DERIVED value withheld for a bidding-primary stage → open warning', () => {
    const r = evaluateOutcomeSyncAlert(healthyInput({ derivedWithheldForBiddingPrimaryStage: true }));
    expect(r.decision).toBe('open');
    expect(r.severity).toBe('warning');
    expect(r.title).toBe('CRM Derived Value Withheld');
  });

  it('picks the WORST applicable condition, not the first one checked', () => {
    // Both identity-degraded (warning-tier) and consecutive-failures
    // (critical-tier) apply — critical must win.
    const r = evaluateOutcomeSyncAlert(healthyInput({ consecutiveFailures: 2, unresolvedIdentityRate7d: 15 }));
    expect(r.title).toBe('CRM Sync Failing');
  });

  it('an active alert with a still-firing condition → update, not open', () => {
    const r = evaluateOutcomeSyncAlert(healthyInput({ consecutiveFailures: 2, existingAlertActive: true }));
    expect(r.decision).toBe('update');
  });

  it('recovery from an active alert → resolve', () => {
    const r = evaluateOutcomeSyncAlert(healthyInput({ existingAlertActive: true }));
    expect(r.decision).toBe('resolve');
  });
});
