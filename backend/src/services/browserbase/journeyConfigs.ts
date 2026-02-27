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

export const JOURNEY_CONFIGS: Record<FunnelType, JourneyStep[]> = {
  ecommerce: [
    {
      name: 'landing',
      urlKey: 'landing',
      waitFor: 'body',
    },
    {
      name: 'product',
      urlKey: 'product',
      waitFor: 'body',
      actions: [
        { type: 'scroll_bottom' },
        { type: 'wait', ms: 500 },
      ],
    },
    {
      name: 'checkout',
      urlKey: 'checkout',
      waitFor: 'body',
      actions: [
        { type: 'wait', ms: 1000 },
      ],
    },
    {
      name: 'confirmation',
      urlKey: 'confirmation',
      waitFor: 'body',
      actions: [
        { type: 'wait', ms: 2000 }, // Allow conversion tags to fire
      ],
    },
  ],

  saas: [
    {
      name: 'landing',
      urlKey: 'landing',
      waitFor: 'body',
    },
    {
      name: 'signup',
      urlKey: 'signup',
      waitFor: 'body',
      actions: [
        { type: 'wait', ms: 500 },
      ],
    },
    {
      name: 'onboarding',
      urlKey: 'onboarding',
      waitFor: 'body',
      actions: [
        { type: 'wait', ms: 1000 },
      ],
    },
  ],

  lead_gen: [
    {
      name: 'landing',
      urlKey: 'landing',
      waitFor: 'body',
    },
    {
      name: 'thank_you',
      urlKey: 'thank_you',
      waitFor: 'body',
      actions: [
        { type: 'wait', ms: 2000 },
      ],
    },
  ],
};
