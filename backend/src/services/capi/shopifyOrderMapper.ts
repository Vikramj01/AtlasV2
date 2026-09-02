// Maps a Shopify Admin API "Order" webhook payload (orders/paid) into an
// AtlasEvent. Field names below match Shopify's long-stable REST Order
// resource shape from training-data knowledge — not verified against a live
// payload in this sandbox (network egress to Shopify's docs is unavailable
// here). Treat as high-confidence but confirm against a real orders/paid
// delivery (e.g. via Shopify's webhook tester) before production traffic.
//
// Click-ID capture: note_attributes carries whatever the storefront capture
// script (shopifyCaptureScript.ts) pushed as cart attributes —
// atlas_gclid/atlas_fbc/atlas_wbraid/atlas_gbraid are Atlas's own attribute
// names (defined and read only by Atlas's own code), not a Shopify or
// third-party convention.
//
// new_customer: derived from customer.orders_count, which Shopify's Order
// resource reports inclusive of the order that triggered this webhook — so
// orders_count === 1 means this is the customer's first order. Also
// training-data knowledge, same confidence caveat as above.

import type { AtlasEvent } from '@/types/capi';

interface ShopifyMoney {
  amount?: string;
}

interface ShopifyAddress {
  city?: string;
  province_code?: string;
  zip?: string;
  country_code?: string;
}

interface ShopifyLineItem {
  product_id?: number | string;
  quantity?: number;
}

interface ShopifyCustomer {
  email?: string;
  phone?: string;
  first_name?: string;
  last_name?: string;
  orders_count?: number;
}

interface ShopifyNoteAttribute {
  name?: string;
  value?: string;
}

export interface ShopifyOrderPayload {
  id: number | string;
  name?: string;
  created_at?: string;
  currency?: string;
  total_price?: string;
  current_total_price?: string;
  email?: string;
  phone?: string;
  customer?: ShopifyCustomer;
  billing_address?: ShopifyAddress;
  line_items?: ShopifyLineItem[];
  order_status_url?: string;
  total_price_set?: { shop_money?: ShopifyMoney };
  note_attributes?: ShopifyNoteAttribute[];
}

function noteAttribute(order: ShopifyOrderPayload, name: string): string | undefined {
  return order.note_attributes?.find((a) => a.name === name)?.value;
}

// All four consent categories are 'not_required' — there is no live browser
// consent decision behind a server-sourced order webhook. See the deliberate
// exception documented on processServerSourcedEvent() in pipeline.ts.
const NO_LIVE_CONSENT = {
  analytics: 'not_required' as const,
  marketing: 'not_required' as const,
  personalisation: 'not_required' as const,
  functional: 'not_required' as const,
};

export function mapShopifyOrderToAtlasEvent(shop: string, order: ShopifyOrderPayload): AtlasEvent {
  const value = parseFloat(
    order.total_price ?? order.current_total_price ?? order.total_price_set?.shop_money?.amount ?? '0',
  );
  const createdAt = order.created_at ? new Date(order.created_at) : new Date();

  const newCustomer = order.customer?.orders_count === undefined
    ? undefined
    : order.customer.orders_count === 1;

  return {
    event_id: `shopify_order_${order.id}`,
    event_name: 'purchase',
    event_time: Math.floor(createdAt.getTime() / 1000),
    event_source_url: order.order_status_url ?? `https://${shop}`,
    action_source: 'system_generated',
    user_data: {
      email: order.email ?? order.customer?.email,
      phone: order.phone ?? order.customer?.phone,
      first_name: order.customer?.first_name,
      last_name: order.customer?.last_name,
      city: order.billing_address?.city,
      state: order.billing_address?.province_code,
      zip: order.billing_address?.zip,
      country: order.billing_address?.country_code,
      gclid: noteAttribute(order, 'atlas_gclid'),
      fbc: noteAttribute(order, 'atlas_fbc'),
      wbraid: noteAttribute(order, 'atlas_wbraid'),
      gbraid: noteAttribute(order, 'atlas_gbraid'),
      ttclid: noteAttribute(order, 'atlas_ttclid'),
    },
    custom_data: {
      value,
      currency: order.currency,
      order_id: String(order.id),
      content_type: 'product',
      content_ids: (order.line_items ?? [])
        .map((li) => (li.product_id !== undefined ? String(li.product_id) : null))
        .filter((id): id is string => id !== null),
      num_items: (order.line_items ?? []).reduce((sum, li) => sum + (li.quantity ?? 0), 0),
      ...(newCustomer !== undefined && { new_customer: newCustomer }),
    },
    consent_state: NO_LIVE_CONSENT,
  };
}
