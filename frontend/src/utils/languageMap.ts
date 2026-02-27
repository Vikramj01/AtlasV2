// Language system — maps technical terms to marketer-friendly language
// Per Atlas UI Wireframe specification

export const TECH_TO_PLAIN: Record<string, string> = {
  'Event failed': 'Conversion did not fire',
  'Parameter missing': 'Required data missing',
  'Hash mismatch': 'Email formatting prevents enhanced matching',
  'Network error': 'Platform did not confirm receipt',
};

export function toPlainLanguage(technical: string): string {
  return TECH_TO_PLAIN[technical] ?? technical;
}

export const PLATFORM_LABELS: Record<string, string> = {
  google_ads: 'Google Ads',
  meta_ads: 'Meta Ads',
  ga4: 'Google Analytics 4',
  gtm: 'Google Tag Manager',
  sgtm: 'Server-side GTM',
};

export const FUNNEL_LABELS: Record<string, string> = {
  ecommerce: 'Ecommerce',
  saas: 'SaaS',
  lead_gen: 'Lead Generation',
};

export const FUNNEL_STAGES: Record<string, string[]> = {
  ecommerce: ['Landing', 'Product', 'Checkout', 'Confirmation', 'Platforms'],
  saas: ['Landing', 'Features', 'Signup', 'Onboarding', 'Platforms'],
  lead_gen: ['Landing', 'Form', 'Thank You', 'Platforms'],
};

export const OVERALL_STATUS_COPY: Record<string, { headline: string; color: string }> = {
  healthy:           { headline: 'Your Conversion Signals Are Healthy',   color: 'green' },
  partially_broken:  { headline: 'Your Signals Are Partially Broken',     color: 'yellow' },
  critical:          { headline: 'Critical Attribution Issues Detected',  color: 'red' },
};

export const EFFORT_LABELS: Record<string, string> = {
  low:    'Low effort',
  medium: 'Medium effort',
  high:   'High effort',
};
