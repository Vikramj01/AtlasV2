import type {
  JourneyDuration,
  LagClass,
  TimingRisk,
  ConversionEventTiming,
} from '@/types/journey';

// Action keys that are inherently long-cycle even when journey_duration is
// not explicitly set to one_to_four_weeks — e.g. a user might say "1–7 days"
// for a generate_lead that actually feeds a 3-week sales cycle, but we do not
// override the user's explicit selection. This list is reserved for future use
// if we add heuristic pre-filling.
export const LONG_LAG_EVENT_TYPES = new Set(['generate_lead']);

export function classifyEvent(journeyDuration: JourneyDuration): LagClass {
  switch (journeyDuration) {
    case 'over_one_month':      return 'deep_lag';
    case 'one_to_four_weeks':   return 'long_lag';
    case 'one_to_seven_days':   return 'short_lag';
    case 'immediate':           return 'immediate';
  }
}

export function getTimingRisk(lagClass: LagClass): TimingRisk {
  switch (lagClass) {
    case 'immediate':  return 'none';
    case 'short_lag':  return 'meta';
    case 'long_lag':   return 'meta_and_loop';
    case 'deep_lag':   return 'critical';
  }
}

export function getPlatformFlags(lagClass: LagClass): ConversionEventTiming['platform_flags'] {
  switch (lagClass) {
    case 'immediate':
      return { meta: 'optimal', google: 'optimal' };
    case 'short_lag':
      return { meta: 'marginal', google: 'optimal' };
    case 'long_lag':
      return { meta: 'outside_window', google: 'marginal' };
    case 'deep_lag':
      return { meta: 'outside_window', google: 'marginal' };
  }
}

export function buildTimingResult(
  journeyDuration: JourneyDuration,
  isProxy = false,
  proxyFor?: string,
): ConversionEventTiming {
  const lag_class = classifyEvent(journeyDuration);
  return {
    journey_duration: journeyDuration,
    lag_class,
    timing_risk: getTimingRisk(lag_class),
    platform_flags: getPlatformFlags(lag_class),
    is_proxy: isProxy,
    proxy_for: proxyFor,
  };
}

// ─── Display helpers ──────────────────────────────────────────────────────────

export interface TimingBadgeConfig {
  label: string;
  colorClass: string; // Tailwind bg + text classes
}

export function getTimingBadgeConfig(lagClass: LagClass): TimingBadgeConfig {
  switch (lagClass) {
    case 'immediate':
      return { label: 'Optimal Signal',               colorClass: 'bg-green-100 text-green-800' };
    case 'short_lag':
      return { label: 'Timing Risk: Meta',             colorClass: 'bg-amber-100 text-amber-800' };
    case 'long_lag':
      return { label: 'Timing Risk: Meta + Loop',      colorClass: 'bg-red-100 text-red-800' };
    case 'deep_lag':
      return { label: 'Critical Timing Risk',          colorClass: 'bg-red-100 text-red-900' };
  }
}

export interface PlatformAssessment {
  icon: '✅' | '⚠️' | '❌';
  copy: string;
}

export function getMetaAssessment(lagClass: LagClass): PlatformAssessment {
  switch (lagClass) {
    case 'immediate':
      return { icon: '✅', copy: 'Within real-time window. Event will be used for optimisation.' };
    case 'short_lag':
      return { icon: '⚠️', copy: 'Borderline. Events arriving beyond 2h will degrade Meta performance.' };
    case 'long_lag':
      return { icon: '❌', copy: 'Beyond 24h attribution window. Meta cannot optimise on this event.' };
    case 'deep_lag':
      return { icon: '❌', copy: 'Beyond 24h attribution window. Cannot optimise on this event.' };
  }
}

export function getGoogleAssessment(lagClass: LagClass): PlatformAssessment {
  switch (lagClass) {
    case 'immediate':
      return { icon: '✅', copy: 'Within Smart Bidding tolerance. Event will be used for optimisation.' };
    case 'short_lag':
      return { icon: '✅', copy: 'Within Smart Bidding tolerance for this lag duration.' };
    case 'long_lag':
      return { icon: '⚠️', copy: 'Accepted up to 90 days, but ties campaign feedback loop to your sales cycle length.' };
    case 'deep_lag':
      return { icon: '⚠️', copy: 'Accepted up to 90 days, but creates a 30+ day feedback loop delaying campaign learning.' };
  }
}

export function getRiskSummary(lagClass: LagClass, eventName: string): string {
  switch (lagClass) {
    case 'immediate':
      return `${eventName} fires within the session window. Both Meta and Google can use it for real-time optimisation.`;
    case 'short_lag':
      return `${eventName} may arrive outside Meta's 2h preference window for some journeys. Consider a same-session proxy to strengthen Meta signal volume.`;
    case 'long_lag':
      return `${eventName} falls outside Meta's attribution window and will create a feedback loop on Google, delaying campaign learning by the length of your sales cycle.`;
    case 'deep_lag':
      return `${eventName} falls well outside Meta's attribution window and will create a 30+ day feedback loop on Google, delaying campaign learning by the same duration as your sales cycle.`;
  }
}
