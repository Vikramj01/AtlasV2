// Refund/return feedback to platforms.
//
// Google has two independent legs: audience removal (real, DMA-native, via
// customerMatch.ts's ingestCustomerMatchBatch — stops future optimization on
// the refunded customer) and an adjustment CSV (best-effort format for Google
// Ads' own "Uploads -> Conversion Adjustments" UI, which the client uploads
// themselves — Atlas has no visibility into whether they actually did).
// Meta is logged only; no reversal API exists there.

export type GoogleRemovalStatus = 'pending' | 'removed' | 'failed' | 'skipped';

export interface RefundEvent {
  id: string;
  organization_id: string;
  client_id: string | null;
  original_transaction_id: string;
  refund_amount: number;
  currency: string;
  is_partial: boolean;
  /** Required for partial refunds: the corrected order total AFTER the refund (absolute, not a delta). */
  new_conversion_value: number | null;
  reason: string | null;
  hashed_email: string | null;
  hashed_phone: string | null;
  google_removal_status: GoogleRemovalStatus;
  google_removal_error: string | null;
  adjustment_csv_generated_at: string | null;
  meta_status: 'logged';
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface RecordRefundInput {
  original_transaction_id: string;
  refund_amount: number;
  currency: string;
  is_partial: boolean;
  /** Required when is_partial — the corrected order total AFTER the refund (absolute, not a delta). */
  new_conversion_value?: number;
  reason?: string;
  /** Raw — used in-memory for the Google audience-removal call, never persisted. */
  email?: string;
  /** Raw — used in-memory for the Google audience-removal call, never persisted. */
  phone?: string;
  client_id?: string;
}
