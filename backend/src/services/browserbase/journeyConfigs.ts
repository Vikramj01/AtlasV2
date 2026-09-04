/**
 * Journey step definitions per funnel type.
 * Each step describes: name, URL (from url_map), optional wait selector, and actions.
 */
import type { FunnelType } from '@/types/audit';

export interface JourneyStep {
  name: string;
  urlKey: string;     // Key into url_map provided by user
  waitFor?: string;   // CSS selector to wait for after navigation
  actions?: StepAction[];
}

export type StepAction =
  | { type: 'click'; selector: string }
  | { type: 'fill'; selector: string; value: string }
  | { type: 'wait'; ms: number }
  | { type: 'scroll_bottom' };

/**
 * Scroll to the bottom of the page + a short settle wait, prepended to
 * every step's actions below (Site Evaluation Coverage & Honesty PRD §8.5).
 * Previously only the ecommerce `product` step scrolled — a tag whose
 * trigger only fires on scroll/lazy-load (a common pattern for below-the-
 * fold remarketing pixels, exit-intent tags, or lazy-loaded embeds) was
 * invisible on every other step of every template.
 */
const SCROLL_AND_SETTLE: StepAction[] = [
  { type: 'scroll_bottom' },
  { type: 'wait', ms: 500 },
];

export const JOURNEY_CONFIGS: Record<FunnelType, JourneyStep[]> = {
  ecommerce: [
    {
      name: 'landing',
      urlKey: 'landing',
      waitFor: 'body',
      actions: [...SCROLL_AND_SETTLE],
    },
    {
      name: 'product',
      urlKey: 'product',
      waitFor: 'body',
      actions: [...SCROLL_AND_SETTLE],
    },
    {
      name: 'checkout',
      urlKey: 'checkout',
      waitFor: 'body',
      actions: [
        ...SCROLL_AND_SETTLE,
        { type: 'wait', ms: 1000 },
      ],
    },
    {
      name: 'confirmation',
      urlKey: 'confirmation',
      waitFor: 'body',
      actions: [
        ...SCROLL_AND_SETTLE,
        { type: 'wait', ms: 2000 }, // Allow conversion tags to fire
      ],
    },
  ],

  saas: [
    {
      name: 'landing',
      urlKey: 'landing',
      waitFor: 'body',
      actions: [...SCROLL_AND_SETTLE],
    },
    {
      name: 'signup',
      urlKey: 'signup',
      waitFor: 'body',
      actions: [
        ...SCROLL_AND_SETTLE,
        { type: 'wait', ms: 500 },
      ],
    },
    {
      name: 'onboarding',
      urlKey: 'onboarding',
      waitFor: 'body',
      actions: [
        ...SCROLL_AND_SETTLE,
        { type: 'wait', ms: 1000 },
      ],
    },
  ],

  lead_gen: [
    {
      name: 'landing',
      urlKey: 'landing',
      waitFor: 'body',
      actions: [...SCROLL_AND_SETTLE],
    },
    {
      name: 'thank_you',
      urlKey: 'thank_you',
      waitFor: 'body',
      actions: [
        ...SCROLL_AND_SETTLE,
        { type: 'wait', ms: 2000 },
      ],
    },
  ],
};
