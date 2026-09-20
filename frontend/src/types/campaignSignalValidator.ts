export type VerdictRating = 'strong' | 'moderate' | 'weak';
export type AIMaxRisk = 'low' | 'medium' | 'high';

export interface VerdictReasonCode {
  code: string;
  severity: 'high' | 'medium' | 'low';
  headline: string;
  detail: string;
}

// Attribution Chain Check PRD — mirrors backend/src/services/attribution/chainModel.ts.
// Lead-gen only; undefined for an ecommerce/saas site or when the
// underlying browser-based scan failed (the backend fails open, never
// fails the whole diagnostic on this).
export type ChainLinkVerdict = 'PASS' | 'FAIL' | 'NOT_OBSERVED';
export type ChainLink = 'arrival' | 'persistence' | 'form_carriage' | 'crm_arrival' | 'real_population';
export type RemedyTier = 1 | 2 | 3 | 4 | 5;
export type NotObservedReason = 'no_paid_traffic' | 'no_conversion_surface';

export interface AttributionChainResult {
  links: Record<ChainLink, ChainLinkVerdict>;
  break_at: ChainLink | null;
  break_evidence: string;
  remedy_tier: RemedyTier | null;
  not_observed_reason: NotObservedReason | null;
  scope: 'pre_connection' | 'post_connection';
}

export interface EventVerdict {
  rating: VerdictRating;
  score: number;
  ai_max_risk: AIMaxRisk;
  reasons: VerdictReasonCode[];
  remediation: string[];
  summary: string;
  attribution_chain?: AttributionChainResult;
}

export interface SignalValidatorRun {
  id: string;
  organization_id: string | null;
  client_id: string | null;
  source: 'in_app' | 'standalone';
  url: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  site_detection: Record<string, unknown> | null;
  verdict: EventVerdict | null;
  error_message: string | null;
  pdf_storage_path: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface SignalValidatorScanResponse {
  id: string;
  status: 'completed' | 'failed';
  verdict: EventVerdict | null;
  error_message: string | null;
}

export interface SignalValidatorCheckoutResponse {
  checkoutUrl: string;
  sessionId: string;
}

export interface SignalValidatorPurchaseStatus {
  status: 'pending' | 'paid' | 'refunded';
  run: SignalValidatorRun | null;
  pdf_url: string | null;
}
