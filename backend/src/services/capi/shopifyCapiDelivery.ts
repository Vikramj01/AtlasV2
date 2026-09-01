// Delivers a Shopify-sourced AtlasEvent to every active CAPI provider
// connected to an org. Reuses processServerSourcedEvent() (pipeline.ts) —
// the same dedup/hash/deliver/log/counters pipeline as a live event, minus
// the consent gate that doesn't apply to a server-sourced webhook.

import { listProviders, getProvider } from '@/services/database/capiQueries';
import { processServerSourcedEvent } from './pipeline';
import type { AtlasEvent } from '@/types/capi';
import type { PipelineResult } from './pipeline';
import logger from '@/utils/logger';

export async function deliverShopifyEventToAllProviders(organizationId: string, event: AtlasEvent): Promise<PipelineResult[]> {
  const providers = await listProviders(organizationId);
  const active = providers.filter((p) => p.status === 'active');

  if (active.length === 0) {
    logger.info({ organizationId, eventId: event.event_id }, 'Shopify CAPI delivery: no active providers, skipping');
    return [];
  }

  const results: PipelineResult[] = [];
  for (const summary of active) {
    const fullConfig = await getProvider(summary.id, organizationId);
    if (!fullConfig) continue;

    try {
      const result = await processServerSourcedEvent(event, fullConfig);
      results.push(result);
    } catch (err) {
      logger.error({ err, organizationId, providerId: summary.id, eventId: event.event_id }, 'Shopify CAPI delivery: provider threw');
      results.push({ event_id: event.event_id, status: 'failed', error_message: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}
