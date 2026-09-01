// Stages a verified Shopify webhook payload and enqueues it for processing.
// Keeps the webhook route itself fast (ack Shopify within its 5s deadline)
// and keeps PII out of the Bull job payload — the raw payload lives in
// shopify_webhook_events, the job only carries its id.

import { supabaseAdmin } from '@/services/database/supabase';
import { shopifyWebhookEventQueue } from '@/services/queue/jobQueue';

async function stageAndEnqueue(shop: string, topic: string, payload: unknown): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('shopify_webhook_events')
    .insert({ shop_domain: shop, topic, payload })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`Failed to stage Shopify webhook event: ${error?.message ?? 'unknown'}`);
  }

  await shopifyWebhookEventQueue.add({ event_id: (data as { id: string }).id });
}

export async function enqueueShopifyOrderEvent(shop: string, payload: unknown): Promise<void> {
  await stageAndEnqueue(shop, 'orders/paid', payload);
}

export async function enqueueShopifyRefundEvent(shop: string, payload: unknown): Promise<void> {
  await stageAndEnqueue(shop, 'refunds/create', payload);
}
