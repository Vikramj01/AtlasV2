/**
 * classifyEvent.test.ts — Journey timing classification utilities
 *
 * Pure functions: no side effects, no network, no DOM.
 * Tests all lag-class mappings, risk levels, platform flags, and display helpers.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyEvent,
  getTimingRisk,
  getPlatformFlags,
  buildTimingResult,
  getTimingBadgeConfig,
  getMetaAssessment,
  getGoogleAssessment,
  getRiskSummary,
  lagClassToDefaultDuration,
} from '../classifyEvent';

// ── classifyEvent ─────────────────────────────────────────────────────────────

describe('classifyEvent', () => {
  it('maps immediate to immediate', () => {
    expect(classifyEvent('immediate')).toBe('immediate');
  });

  it('maps one_to_seven_days to short_lag', () => {
    expect(classifyEvent('one_to_seven_days')).toBe('short_lag');
  });

  it('maps one_to_four_weeks to long_lag', () => {
    expect(classifyEvent('one_to_four_weeks')).toBe('long_lag');
  });

  it('maps over_one_month to deep_lag', () => {
    expect(classifyEvent('over_one_month')).toBe('deep_lag');
  });
});

// ── getTimingRisk ─────────────────────────────────────────────────────────────

describe('getTimingRisk', () => {
  it('immediate → none', () => expect(getTimingRisk('immediate')).toBe('none'));
  it('short_lag → meta', () => expect(getTimingRisk('short_lag')).toBe('meta'));
  it('long_lag → meta_and_loop', () => expect(getTimingRisk('long_lag')).toBe('meta_and_loop'));
  it('deep_lag → critical', () => expect(getTimingRisk('deep_lag')).toBe('critical'));
});

// ── getPlatformFlags ──────────────────────────────────────────────────────────

describe('getPlatformFlags', () => {
  it('immediate: both optimal', () => {
    const flags = getPlatformFlags('immediate');
    expect(flags.meta).toBe('optimal');
    expect(flags.google).toBe('optimal');
  });

  it('short_lag: meta marginal, google optimal', () => {
    const flags = getPlatformFlags('short_lag');
    expect(flags.meta).toBe('marginal');
    expect(flags.google).toBe('optimal');
  });

  it('long_lag: meta outside_window, google marginal', () => {
    const flags = getPlatformFlags('long_lag');
    expect(flags.meta).toBe('outside_window');
    expect(flags.google).toBe('marginal');
  });

  it('deep_lag: meta outside_window, google marginal', () => {
    const flags = getPlatformFlags('deep_lag');
    expect(flags.meta).toBe('outside_window');
    expect(flags.google).toBe('marginal');
  });
});

// ── buildTimingResult ─────────────────────────────────────────────────────────

describe('buildTimingResult', () => {
  it('assembles a full ConversionEventTiming object', () => {
    const result = buildTimingResult('immediate');
    expect(result.journey_duration).toBe('immediate');
    expect(result.lag_class).toBe('immediate');
    expect(result.timing_risk).toBe('none');
    expect(result.platform_flags.meta).toBe('optimal');
    expect(result.is_proxy).toBe(false);
    expect(result.proxy_for).toBeUndefined();
  });

  it('sets is_proxy and proxy_for when provided', () => {
    const result = buildTimingResult('one_to_seven_days', true, 'stage-001');
    expect(result.is_proxy).toBe(true);
    expect(result.proxy_for).toBe('stage-001');
  });

  it('correctly classifies a long_lag event', () => {
    const result = buildTimingResult('one_to_four_weeks');
    expect(result.lag_class).toBe('long_lag');
    expect(result.timing_risk).toBe('meta_and_loop');
    expect(result.platform_flags.meta).toBe('outside_window');
  });
});

// ── getTimingBadgeConfig ──────────────────────────────────────────────────────

describe('getTimingBadgeConfig', () => {
  it('immediate: Optimal Signal label with green colour', () => {
    const { label, colorClass } = getTimingBadgeConfig('immediate');
    expect(label).toBe('Optimal Signal');
    expect(colorClass).toContain('green');
  });

  it('short_lag: Timing Risk: Meta label with amber colour', () => {
    const { label, colorClass } = getTimingBadgeConfig('short_lag');
    expect(label).toContain('Meta');
    expect(colorClass).toContain('amber');
  });

  it('long_lag: includes Meta + Loop label', () => {
    const { label } = getTimingBadgeConfig('long_lag');
    expect(label).toContain('Loop');
  });

  it('deep_lag: Critical label with red colour', () => {
    const { label, colorClass } = getTimingBadgeConfig('deep_lag');
    expect(label).toContain('Critical');
    expect(colorClass).toContain('red');
  });
});

// ── getMetaAssessment ─────────────────────────────────────────────────────────

describe('getMetaAssessment', () => {
  it('immediate: ✅ icon', () => {
    expect(getMetaAssessment('immediate').icon).toBe('✅');
  });

  it('short_lag: ⚠️ icon', () => {
    expect(getMetaAssessment('short_lag').icon).toBe('⚠️');
  });

  it('long_lag: ❌ icon', () => {
    expect(getMetaAssessment('long_lag').icon).toBe('❌');
  });

  it('deep_lag: ❌ icon', () => {
    expect(getMetaAssessment('deep_lag').icon).toBe('❌');
  });

  it('all assessments have non-empty copy', () => {
    const classes = ['immediate', 'short_lag', 'long_lag', 'deep_lag'] as const;
    for (const c of classes) {
      expect(getMetaAssessment(c).copy.length).toBeGreaterThan(0);
    }
  });
});

// ── getGoogleAssessment ───────────────────────────────────────────────────────

describe('getGoogleAssessment', () => {
  it('immediate: ✅ icon', () => {
    expect(getGoogleAssessment('immediate').icon).toBe('✅');
  });

  it('short_lag: ✅ icon (Google tolerates short lag)', () => {
    expect(getGoogleAssessment('short_lag').icon).toBe('✅');
  });

  it('long_lag: ⚠️ icon with DMA mention', () => {
    const { icon, copy } = getGoogleAssessment('long_lag');
    expect(icon).toBe('⚠️');
    expect(copy.toLowerCase()).toContain('dma');
  });

  it('deep_lag: ⚠️ icon with DMA mention', () => {
    const { icon, copy } = getGoogleAssessment('deep_lag');
    expect(icon).toBe('⚠️');
    expect(copy.toLowerCase()).toContain('dma');
  });
});

// ── getRiskSummary ────────────────────────────────────────────────────────────

describe('getRiskSummary', () => {
  it('returns a non-empty string for all lag classes', () => {
    const classes = ['immediate', 'short_lag', 'long_lag', 'deep_lag'] as const;
    for (const c of classes) {
      const summary = getRiskSummary(c, 'purchase');
      expect(typeof summary).toBe('string');
      expect(summary.length).toBeGreaterThan(0);
    }
  });

  it('includes the event name in the summary', () => {
    const summary = getRiskSummary('immediate', 'submit_lead');
    expect(summary).toContain('submit_lead');
  });
});

// ── lagClassToDefaultDuration ─────────────────────────────────────────────────

describe('lagClassToDefaultDuration', () => {
  it('immediate → immediate', () => {
    expect(lagClassToDefaultDuration('immediate')).toBe('immediate');
  });

  it('short_lag → one_to_seven_days', () => {
    expect(lagClassToDefaultDuration('short_lag')).toBe('one_to_seven_days');
  });

  it('long_lag → one_to_four_weeks', () => {
    expect(lagClassToDefaultDuration('long_lag')).toBe('one_to_four_weeks');
  });

  it('deep_lag → over_one_month', () => {
    expect(lagClassToDefaultDuration('deep_lag')).toBe('over_one_month');
  });

  it('round-trips with classifyEvent', () => {
    const durations = ['immediate', 'one_to_seven_days', 'one_to_four_weeks', 'over_one_month'] as const;
    for (const d of durations) {
      const lagClass = classifyEvent(d);
      const recovered = lagClassToDefaultDuration(lagClass);
      expect(recovered).toBe(d);
    }
  });
});
