import { describe, it, expect } from 'vitest';
import { isEventInScope, resolveGateConfig, DEFAULT_LEAD_EVENT_NAMES } from '../config';
import { DEFAULT_THRESHOLDS } from '../types';

describe('default scope (lead-type events from the Journey Builder vocabulary; purchase excluded)', () => {
  it.each(['generate_lead', 'sign_up', 'lead', 'form_submit', 'Lead', 'GENERATE_LEAD'])('includes %s', (n) => {
    expect(isEventInScope(n, { event_names: [] })).toBe(true);
  });
  it.each(['purchase', 'Purchase', 'page_view', 'add_to_cart', 'begin_checkout', 'atlas_refund', 'atlas_order_cancellation'])('excludes %s', (n) => {
    expect(isEventInScope(n, { event_names: [] })).toBe(false);
  });
  it('is derived from the Journey Builder conversion primitives, minus purchase', () => {
    expect(DEFAULT_LEAD_EVENT_NAMES.has('purchase')).toBe(false);
    expect(DEFAULT_LEAD_EVENT_NAMES.has('generate_lead')).toBe(true);
  });
});

describe('explicit scope', () => {
  it('replaces the default entirely, case-insensitively', () => {
    expect(isEventInScope('Demo_Request', { event_names: ['demo_request'] })).toBe(true);
    expect(isEventInScope('generate_lead', { event_names: ['demo_request'] })).toBe(false);
  });
  it('lets a client opt a normally-excluded event in', () => {
    expect(isEventInScope('purchase', { event_names: ['purchase'] })).toBe(true);
  });
});

describe('resolveGateConfig', () => {
  it('no saved config = observe + default scope + default thresholds (PRD §C.8)', () => {
    expect(resolveGateConfig(null)).toEqual({
      mode: 'observe', event_names: [], rule_flags: {}, thresholds: DEFAULT_THRESHOLDS,
      action_junk: 'hold', action_suspect: 'hold', hold_timeout_hours: 24, timeout_action: 'release',
    });
  });
  it('merges a partial row over the defaults', () => {
    const c = resolveGateConfig({ mode: 'off', thresholds: { velocity_max: 9 } });
    expect(c.mode).toBe('off');
    expect(c.thresholds).toEqual({ ...DEFAULT_THRESHOLDS, velocity_max: 9 });
  });
  it('an invalid threshold (zero, negative, NaN, string) falls back to the default instead of disabling a rule', () => {
    const c = resolveGateConfig({ thresholds: { velocity_max: 0, duplicate_window_minutes: -5, suspect_soft_hits: Number.NaN, velocity_window_minutes: '60' as unknown as number } });
    expect(c.thresholds).toEqual(DEFAULT_THRESHOLDS);
  });
  it('C2 fields: valid values pass through, invalid ones fall back to the safe default', () => {
    const ok = resolveGateConfig({ action_junk: 'drop', action_suspect: 'send', hold_timeout_hours: 48, timeout_action: 'drop' });
    expect(ok).toMatchObject({ action_junk: 'drop', action_suspect: 'send', hold_timeout_hours: 48, timeout_action: 'drop' });
    const bad = resolveGateConfig({ action_junk: 'nuke' as never, hold_timeout_hours: 9999, timeout_action: 'explode' as never });
    expect(bad).toMatchObject({ action_junk: 'hold', hold_timeout_hours: 72, timeout_action: 'release' });
    expect(resolveGateConfig({ hold_timeout_hours: -3 }).hold_timeout_hours).toBe(24);
  });
  it('the timeout action fails open: only an explicit drop drops', () => {
    expect(resolveGateConfig({ timeout_action: null }).timeout_action).toBe('release');
    expect(resolveGateConfig({}).timeout_action).toBe('release');
  });
});
