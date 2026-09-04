/**
 * journeyConfigs.ts — Site Evaluation Coverage & Honesty PRD §8.5: every
 * step in every template must scroll (+ settle) before the crawl moves on,
 * not just ecommerce's `product` step — a tag whose trigger only fires on
 * scroll/lazy-load was previously invisible everywhere else.
 */
import { describe, it, expect } from 'vitest';
import { JOURNEY_CONFIGS } from '../journeyConfigs';
import type { FunnelType } from '@/types/audit';

const FUNNEL_TYPES: FunnelType[] = ['ecommerce', 'saas', 'lead_gen'];

describe('JOURNEY_CONFIGS — scroll on every step', () => {
  it.each(FUNNEL_TYPES)('every step in the %s template scrolls to the bottom', (funnelType) => {
    for (const step of JOURNEY_CONFIGS[funnelType]) {
      const hasScroll = (step.actions ?? []).some((a) => a.type === 'scroll_bottom');
      expect(hasScroll, `${funnelType}/${step.name} has no scroll_bottom action`).toBe(true);
    }
  });

  it.each(FUNNEL_TYPES)('scroll is always followed by a settle wait in the %s template', (funnelType) => {
    for (const step of JOURNEY_CONFIGS[funnelType]) {
      const actions = step.actions ?? [];
      const scrollIndex = actions.findIndex((a) => a.type === 'scroll_bottom');
      expect(scrollIndex, `${funnelType}/${step.name}`).toBeGreaterThanOrEqual(0);
      const next = actions[scrollIndex + 1];
      expect(next?.type, `${funnelType}/${step.name} — no wait immediately after scroll`).toBe('wait');
    }
  });

  it('does not remove existing step-specific waits (e.g. confirmation still waits for conversion tags)', () => {
    const confirmation = JOURNEY_CONFIGS.ecommerce.find((s) => s.name === 'confirmation')!;
    const waitDurations = (confirmation.actions ?? [])
      .filter((a): a is { type: 'wait'; ms: number } => a.type === 'wait')
      .map((a) => a.ms);
    expect(waitDurations).toContain(2000);
  });

  it('every template still has exactly the same step names/order as before this change', () => {
    expect(JOURNEY_CONFIGS.ecommerce.map((s) => s.name)).toEqual(['landing', 'product', 'checkout', 'confirmation']);
    expect(JOURNEY_CONFIGS.saas.map((s) => s.name)).toEqual(['landing', 'signup', 'onboarding']);
    expect(JOURNEY_CONFIGS.lead_gen.map((s) => s.name)).toEqual(['landing', 'thank_you']);
  });
});
