export type DirectTier =
  | 'diagnostic'
  | 'monitor'
  | 'management'
  | 'operations'
  | 'enterprise';

export type AgencyTier =
  | 'agency_starter'
  | 'agency_growth'
  | 'agency_scale'
  | 'agency_enterprise';

export type AtlasTier = DirectTier | AgencyTier;

export type BillingCadence = 'one_time' | 'monthly' | 'quarterly' | 'annual';

export type Currency = 'USD' | 'AED' | 'SGD';

interface DirectTierConfig {
  type: 'direct';
  mrr_usd: number;
  mrr_aed: number;
  mrr_sgd: number;
  domains: number;
  page_cap_per_domain: number;
  scans_per_month: number;
  ai_reports_per_month: number;
  ondemand_queries_per_month: number;
  scan_cadence: 'weekly' | 'daily' | 'daily_plus_ondemand';
}

interface AgencyTierConfig {
  type: 'agency';
  mrr_usd: number;
  mrr_aed: number;
  mrr_sgd: number;
  max_clients: number;
  domains_per_client: number;
  page_cap_per_domain: number;
  scans_per_month: number;
  ai_reports_per_month_per_client: number;
  ondemand_queries_per_month_per_client: number;
  scan_cadence: 'weekly' | 'daily' | 'daily_plus_ondemand';
  white_label_included: boolean;
}

export type TierConfig = DirectTierConfig | AgencyTierConfig;

export const ATLAS_PRICING: Record<AtlasTier, TierConfig> = {

  // ─── Direct tiers ────────────────────────────────────────────────────────────

  diagnostic: {
    type:                         'direct',
    mrr_usd:                      750,    // one-time, not MRR
    mrr_aed:                      2750,
    mrr_sgd:                      900,
    domains:                      1,
    page_cap_per_domain:          25,
    scans_per_month:              1,      // single audit run
    ai_reports_per_month:         1,
    ondemand_queries_per_month:   0,
    scan_cadence:                 'weekly',
  },

  monitor: {
    type:                         'direct',
    mrr_usd:                      800,
    mrr_aed:                      2950,
    mrr_sgd:                      950,
    domains:                      1,
    page_cap_per_domain:          25,
    scans_per_month:              4,      // weekly
    ai_reports_per_month:         1,
    ondemand_queries_per_month:   0,
    scan_cadence:                 'weekly',
  },

  management: {
    type:                         'direct',
    mrr_usd:                      1500,
    mrr_aed:                      5500,
    mrr_sgd:                      1800,
    domains:                      3,
    page_cap_per_domain:          100,
    scans_per_month:              30,     // daily
    ai_reports_per_month:         4,
    ondemand_queries_per_month:   0,
    scan_cadence:                 'daily',
  },

  operations: {
    type:                         'direct',
    mrr_usd:                      2700,
    mrr_aed:                      9900,
    mrr_sgd:                      3200,
    domains:                      10,
    page_cap_per_domain:          100,
    scans_per_month:              30,     // daily
    ai_reports_per_month:         4,
    ondemand_queries_per_month:   100,
    scan_cadence:                 'daily_plus_ondemand',
  },

  enterprise: {
    type:                         'direct',
    mrr_usd:                      0,      // custom — set on org_subscriptions directly
    mrr_aed:                      0,
    mrr_sgd:                      0,
    domains:                      999,    // effectively unlimited
    page_cap_per_domain:          999,
    scans_per_month:              999,
    ai_reports_per_month:         999,
    ondemand_queries_per_month:   999,
    scan_cadence:                 'daily_plus_ondemand',
  },

  // ─── Agency tiers ─────────────────────────────────────────────────────────────

  agency_starter: {
    type:                                  'agency',
    mrr_usd:                               2500,
    mrr_aed:                               9200,
    mrr_sgd:                               2950,
    max_clients:                           5,
    domains_per_client:                    3,
    page_cap_per_domain:                   25,
    scans_per_month:                       4,
    ai_reports_per_month_per_client:       1,
    ondemand_queries_per_month_per_client: 0,
    scan_cadence:                          'weekly',
    white_label_included:                  false,
  },

  agency_growth: {
    type:                                  'agency',
    mrr_usd:                               5500,
    mrr_aed:                               20200,
    mrr_sgd:                               6500,
    max_clients:                           15,
    domains_per_client:                    3,
    page_cap_per_domain:                   50,
    scans_per_month:                       30,
    ai_reports_per_month_per_client:       4,
    ondemand_queries_per_month_per_client: 0,
    scan_cadence:                          'daily',
    white_label_included:                  false,  // available as add-on
  },

  agency_scale: {
    type:                                  'agency',
    mrr_usd:                               10000,
    mrr_aed:                               36750,
    mrr_sgd:                               11800,
    max_clients:                           40,
    domains_per_client:                    3,
    page_cap_per_domain:                   50,
    scans_per_month:                       30,
    ai_reports_per_month_per_client:       4,
    ondemand_queries_per_month_per_client: 30,
    scan_cadence:                          'daily_plus_ondemand',
    white_label_included:                  true,
  },

  agency_enterprise: {
    type:                                  'agency',
    mrr_usd:                               0,      // custom
    mrr_aed:                               0,
    mrr_sgd:                               0,
    max_clients:                           999,
    domains_per_client:                    999,
    page_cap_per_domain:                   999,
    scans_per_month:                       999,
    ai_reports_per_month_per_client:       999,
    ondemand_queries_per_month_per_client: 999,
    scan_cadence:                          'daily_plus_ondemand',
    white_label_included:                  true,
  },
};

// ─── Billing discounts ────────────────────────────────────────────────────────

export const BILLING_DISCOUNTS: Record<BillingCadence, number> = {
  one_time:  0,
  monthly:   0,
  quarterly: 0.10,   // 10% discount
  annual:    0.20,   // 20% discount
};

// Accelerator partner discount — applied on top of cadence discount
export const ACCELERATOR_DISCOUNT = 0.25;  // 25% off Management tier for 12 months

// ─── Add-on pricing (USD) ─────────────────────────────────────────────────────

export const ATLAS_ADDONS = {
  extra_domain_direct:        150,   // per domain per month
  extra_domain_agency:        100,   // per additional domain per client per month
  ondemand_query_pack:        250,   // 100 extra queries per month
  dedicated_signal_operator:  950,   // human expert, per month
  white_label_branding:       500,   // agency-only, per month
} as const;

// ─── Helper utilities ─────────────────────────────────────────────────────────

export function getEffectiveMrrUsd(
  tier: AtlasTier,
  cadence: BillingCadence,
  customPriceUsd?: number,
  isAcceleratorPartner?: boolean,
): number {
  const baseMrr = customPriceUsd ?? ATLAS_PRICING[tier].mrr_usd;
  const cadenceDiscount = BILLING_DISCOUNTS[cadence];
  const acceleratorDiscount = isAcceleratorPartner ? ACCELERATOR_DISCOUNT : 0;
  // Discounts don't stack multiplicatively — take the larger one
  const effectiveDiscount = Math.max(cadenceDiscount, acceleratorDiscount);
  return baseMrr * (1 - effectiveDiscount);
}

export function getPageCap(tier: AtlasTier): number {
  return ATLAS_PRICING[tier].page_cap_per_domain;
}

export function getMaxClients(tier: AtlasTier): number | null {
  const config = ATLAS_PRICING[tier];
  if (config.type === 'agency') return config.max_clients;
  return null;
}

export function getDomainCap(tier: AtlasTier): number {
  const config = ATLAS_PRICING[tier];
  if (config.type === 'direct') return config.domains;
  // For agency tiers, total domain capacity is domains_per_client × max_clients
  return config.domains_per_client * config.max_clients;
}
