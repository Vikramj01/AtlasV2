export type VerdictRating = 'strong' | 'moderate' | 'weak';
export type AIMaxRisk = 'low' | 'medium' | 'high';

export interface VerdictReasonCode {
  code: string;
  severity: 'high' | 'medium' | 'low';
  headline: string;
  detail: string;
}

export interface EventVerdict {
  rating: VerdictRating;
  score: number;
  ai_max_risk: AIMaxRisk;
  reasons: VerdictReasonCode[];
  remediation: string[];
  summary: string;
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
