// Check Register v2 — Scan Inputs option lists.
// Atlas Check Register v1.0 (2 September 2026) — "Scan Inputs" / "Site Type Overlays" sheets.
import type { SiteType, SecondaryMotion, DeclaredPlatform, TrafficRegion, CMP, FunnelType } from '@/types/audit';

export const SITE_TYPE_OPTIONS: { value: SiteType; label: string; description: string }[] = [
  { value: 'plg_saas',            label: 'PLG SaaS',            description: 'First paid subscription, self-serve signup' },
  { value: 'ecommerce',           label: 'Ecommerce',           description: 'Purchase, cart → checkout → confirmation' },
  { value: 'lead_gen_b2b',        label: 'Lead Gen B2B',        description: 'Qualified lead or opportunity' },
  { value: 'marketplace',         label: 'Marketplace',         description: 'Completed transaction, two-sided supply/demand' },
  { value: 'app_install',         label: 'App Install',         description: 'Install or first open' },
  { value: 'subscription_media',  label: 'Subscription Media',  description: 'Paid subscription start' },
];

export const SECONDARY_MOTION_OPTIONS: { value: SecondaryMotion; label: string }[] = [
  { value: 'none',            label: 'None' },
  { value: 'sales_assisted',  label: 'Sales-assisted' },
  { value: 'hybrid',          label: 'Hybrid' },
];

export const DECLARED_PLATFORM_OPTIONS: { value: DeclaredPlatform; label: string }[] = [
  { value: 'google_ads', label: 'Google Ads' },
  { value: 'meta',       label: 'Meta' },
  { value: 'tiktok',     label: 'TikTok' },
  { value: 'linkedin',   label: 'LinkedIn' },
  { value: 'microsoft',  label: 'Microsoft' },
  { value: 'reddit',     label: 'Reddit' },
  { value: 'pinterest',  label: 'Pinterest' },
];

export const TRAFFIC_REGION_OPTIONS: { value: TrafficRegion; label: string }[] = [
  { value: 'eea',         label: 'EEA' },
  { value: 'uk',          label: 'UK' },
  { value: 'switzerland', label: 'Switzerland' },
  { value: 'brazil',      label: 'Brazil' },
  { value: 'us',          label: 'United States' },
  { value: 'other',       label: 'Other' },
];

export const CMP_OPTIONS: { value: CMP; label: string }[] = [
  { value: 'onetrust',     label: 'OneTrust' },
  { value: 'cookiebot',    label: 'Cookiebot' },
  { value: 'usercentrics', label: 'Usercentrics' },
  { value: 'custom',       label: 'Custom' },
  { value: 'none',         label: 'None' },
];

export const MONTHLY_SPEND_BAND_OPTIONS: { value: string; label: string }[] = [
  { value: 'under_10k', label: 'Under $10k/mo' },
  { value: '10k_50k',   label: '$10k–$50k/mo' },
  { value: '50k_250k',  label: '$50k–$250k/mo' },
  { value: 'over_250k', label: 'Over $250k/mo' },
];

/**
 * Bridges a v2 site_type onto the legacy 3-value FunnelType so the journey
 * step fields shown below (and the actual browser simulation run server-side)
 * use an existing, working journey template. plg_saas/ecommerce/lead_gen_b2b
 * map 1:1 onto their own template; the 3 net-new site types borrow the
 * closest existing shape until dedicated per-site-type journey configs ship
 * (Check Register engine core work) — surfaced in the UI so it's never a
 * silent approximation.
 */
export const SITE_TYPE_TO_FUNNEL_TYPE: Record<SiteType, FunnelType> = {
  plg_saas: 'saas',
  ecommerce: 'ecommerce',
  lead_gen_b2b: 'lead_gen',
  marketplace: 'ecommerce',
  app_install: 'saas',
  subscription_media: 'saas',
};

/** Site types whose journey template is a same-shape stand-in, not yet purpose-built. */
export const SITE_TYPES_USING_BORROWED_TEMPLATE = new Set<SiteType>([
  'marketplace', 'app_install', 'subscription_media',
]);
