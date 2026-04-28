import type { AtlasTier, BillingCadence, Currency } from '../config/pricing';

export interface OrgSubscription {
  id: string;
  org_id: string;
  tier: AtlasTier;
  currency: Currency;
  contracted_price: number;
  mrr_usd: number;
  billing_cadence: BillingCadence;
  cadence_discount_pct: number;
  accelerator_partner: boolean;
  custom_discount_pct: number;
  custom_discount_reason: string | null;
  addons: Record<string, boolean | number>;
  started_at: string;
  ends_at: string | null;
  trial_ends_at: string | null;
  status: 'trial' | 'active' | 'paused' | 'cancelled' | 'expired';
  cancellation_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CapViolation {
  id: string;
  org_id: string;
  cap_type: 'page_scan' | 'domain_count' | 'client_count' | 'query_count';
  domain: string | null;
  cap_value: number;
  actual: number;
  usage_pct: number;
  severity: 'low' | 'medium' | 'high';
  resolved: boolean;
  resolved_at: string | null;
  resolution: string | null;
  created_at: string;
}
