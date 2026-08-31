// Mirrors backend/src/types/refunds.ts

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
  google_removal_status: GoogleRemovalStatus;
  google_removal_error: string | null;
  adjustment_csv_generated_at: string | null;
  meta_status: 'logged';
  created_at: string;
  updated_at: string;
}

export interface RecordRefundPayload {
  original_transaction_id: string;
  refund_amount: number;
  currency: string;
  is_partial: boolean;
  /** Required when is_partial — the corrected order total AFTER the refund (absolute, not a delta). */
  new_conversion_value?: number;
  reason?: string;
  email?: string;
  phone?: string;
  client_id?: string;
}
