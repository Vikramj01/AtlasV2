/**
 * Functional tests — Journey Builder timing classifier
 *
 * classifyEvent, getTimingRisk, getPlatformFlags, buildTimingResult are pure
 * functions with no external dependencies — safe to import and run in Node.
 *
 * The frontend module uses `@/` alias resolved via tsconfig paths. We import
 * directly using relative paths to avoid requiring frontend's vite alias in
 * the backend vitest config.
 *
 * NOTE: The module imports types from '@/types/journey' — these are type-only
 * imports erased at runtime, so the JS execution has no alias dependency.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyEvent,
  getTimingRisk,
  getPlatformFlags,
  buildTimingResult,
  LONG_LAG_EVENT_TYPES,
} from '../../../frontend/src/lib/journey/classifyEvent';

// ── Scenario 1: immediate duration ────────────────────────────────────────────

describe('Scenario 1 — immediate duration → lag_class=immediate, no platform risk', () => {
  it('classifyEvent("immediate") returns "immediate"', () => {
    expect(classifyEvent('immediate')).toBe('immediate');
  });

  it('getTimingRisk("immediate") returns "none"', () => {
    expect(getTimingRisk('immediate')).toBe('none');
  });

  it('getPlatformFlags("immediate") reports both platforms as optimal', () => {
    const flags = getPlatformFlags('immediate');
    expect(flags.meta).toBe('optimal');
    expect(flags.google).toBe('optimal');
  });

  it('buildTimingResult for immediate purchase returns correct shape', () => {
    const result = buildTimingResult('immediate');
    expect(result.lag_class).toBe('immediate');
    expect(result.timing_risk).toBe('none');
    expect(result.platform_flags.meta).toBe('optimal');
    expect(result.platform_flags.google).toBe('optimal');
    expect(result.is_proxy).toBe(false);
  });
});

// ── Scenario 2: 1–4 weeks → long_lag, Meta at risk ───────────────────────────

describe('Scenario 2 — one_to_four_weeks → lag_class=long_lag, Meta risk flagged', () => {
  it('classifyEvent("one_to_four_weeks") returns "long_lag"', () => {
    expect(classifyEvent('one_to_four_weeks')).toBe('long_lag');
  });

  it('getTimingRisk("long_lag") returns "meta_and_loop"', () => {
    expect(getTimingRisk('long_lag')).toBe('meta_and_loop');
  });

  it('getPlatformFlags("long_lag") marks Meta as outside_window, Google as marginal', () => {
    const flags = getPlatformFlags('long_lag');
    expect(flags.meta).toBe('outside_window');
    expect(flags.google).toBe('marginal');
  });

  it('buildTimingResult for one_to_four_weeks has correct lag_class and risk', () => {
    const result = buildTimingResult('one_to_four_weeks');
    expect(result.lag_class).toBe('long_lag');
    expect(result.timing_risk).toBe('meta_and_loop');
    expect(result.journey_duration).toBe('one_to_four_weeks');
  });
});

// ── Scenario 3: 30+ days → deep_lag, both Meta and Google at risk ─────────────

describe('Scenario 3 — over_one_month → lag_class=deep_lag, both platforms at risk', () => {
  it('classifyEvent("over_one_month") returns "deep_lag"', () => {
    expect(classifyEvent('over_one_month')).toBe('deep_lag');
  });

  it('getTimingRisk("deep_lag") returns "critical"', () => {
    expect(getTimingRisk('deep_lag')).toBe('critical');
  });

  it('getPlatformFlags("deep_lag") marks both Meta as outside_window and Google as marginal', () => {
    const flags = getPlatformFlags('deep_lag');
    // deep_lag: Meta cannot use the signal, Google can technically accept but with long loop
    expect(flags.meta).toBe('outside_window');
    expect(flags.google).toBe('marginal');
  });

  it('buildTimingResult for over_one_month is_proxy=false by default', () => {
    const result = buildTimingResult('over_one_month');
    expect(result.lag_class).toBe('deep_lag');
    expect(result.is_proxy).toBe(false);
    expect(result.proxy_for).toBeUndefined();
  });

  it('buildTimingResult with isProxy=true carries proxy metadata', () => {
    const result = buildTimingResult('over_one_month', true, 'purchase');
    expect(result.is_proxy).toBe(true);
    expect(result.proxy_for).toBe('purchase');
  });
});

// ── Scenario 4: Non-conversion event not in LONG_LAG_EVENT_TYPES ──────────────

describe('Scenario 4 — page_view is not treated as a long-lag conversion event', () => {
  it('LONG_LAG_EVENT_TYPES does NOT contain page_view', () => {
    expect(LONG_LAG_EVENT_TYPES.has('page_view')).toBe(false);
  });

  it('LONG_LAG_EVENT_TYPES contains generate_lead (the only heuristic entry)', () => {
    expect(LONG_LAG_EVENT_TYPES.has('generate_lead')).toBe(true);
  });

  it('classifyEvent is duration-driven, not event-name-driven — page_view with immediate duration = immediate', () => {
    // classifyEvent only takes journeyDuration, not eventName.
    // A page_view that somehow gets classified uses duration exclusively.
    expect(classifyEvent('immediate')).toBe('immediate');
  });

  it('one_to_seven_days → short_lag, Meta flagged as marginal, Google optimal', () => {
    // short_lag is between immediate and long_lag
    expect(classifyEvent('one_to_seven_days')).toBe('short_lag');
    expect(getTimingRisk('short_lag')).toBe('meta');
    const flags = getPlatformFlags('short_lag');
    expect(flags.meta).toBe('marginal');
    expect(flags.google).toBe('optimal');
  });
});
