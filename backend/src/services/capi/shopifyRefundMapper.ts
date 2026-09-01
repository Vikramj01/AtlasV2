// Maps a Shopify Admin API "Refund" webhook payload (refunds/create) into
// the existing refund pipeline's RecordRefundInput shape (refundDelivery.ts).
// Field names match Shopify's stable REST Refund resource — same confidence
// caveat as shopifyOrderMapper.ts (not verified against a live payload in
// this sandbox).
//
// The refund webhook itself carries neither the original order's total nor
// customer identity — the caller (the queue worker) fetches the order via
// shopifyClient.getOrder() first and passes it in here alongside the refund.

import type { RecordRefundInput } from '@/types/refunds';
import type { ShopifyOrderPayload } from './shopifyOrderMapper';

interface ShopifyRefundTransaction {
  amount?: string;
  currency?: string;
  kind?: string;
  status?: string;
}

export interface ShopifyRefundPayload {
  id: number | string;
  order_id: number | string;
  note?: string | null;
  transactions?: ShopifyRefundTransaction[];
}

function computeRefundAmount(refund: ShopifyRefundPayload, fallbackCurrency: string): { amount: number; currency: string } {
  const successful = (refund.transactions ?? []).filter((t) => t.status === 'success' || t.status === undefined);
  const amount = successful.reduce((sum, t) => sum + parseFloat(t.amount ?? '0'), 0);
  const currency = successful[0]?.currency ?? fallbackCurrency;
  return { amount, currency };
}

export function mapShopifyRefundToRecordRefundInput(
  refund: ShopifyRefundPayload,
  order: ShopifyOrderPayload,
): RecordRefundInput {
  const orderTotal = parseFloat(order.total_price ?? order.current_total_price ?? '0');
  const { amount: refundAmount, currency } = computeRefundAmount(refund, order.currency ?? 'USD');

  const isPartial = refundAmount < orderTotal;

  return {
    original_transaction_id: String(order.id),
    refund_amount: refundAmount,
    currency,
    is_partial: isPartial,
    new_conversion_value: isPartial ? Math.max(0, orderTotal - refundAmount) : undefined,
    reason: refund.note ?? undefined,
    email: order.email ?? order.customer?.email,
    phone: order.phone ?? order.customer?.phone,
  };
}
