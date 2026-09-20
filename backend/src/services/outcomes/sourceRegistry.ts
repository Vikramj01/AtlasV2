/**
 * Source registry — the single map from OutcomeSourceType to its
 * OutcomeSource implementation, shared by outcomes.ts (routes) and
 * syncOrchestrator.ts (Sprint 4) so there's exactly one place that knows
 * which sources exist. Salesforce joined in Sprint 10. File renamed from
 * providerRegistry.ts (docs/prd/universal-outcome-ingestion.md Phase 1);
 * the map's own CrmProvider/CrmProviderName types renamed to
 * OutcomeSource/OutcomeSourceType in Phase 2 (§5.2).
 */

import { hubspotClient } from './sources/hubspotClient';
import { salesforceClient } from './sources/salesforceClient';
import type { OutcomeSource, OutcomeSourceType } from './sources/types';

const SOURCES: Partial<Record<OutcomeSourceType, OutcomeSource>> = {
  hubspot: hubspotClient,
  salesforce: salesforceClient,
};

export function getProvider(name: OutcomeSourceType): OutcomeSource {
  const provider = SOURCES[name];
  if (!provider) throw new Error(`Outcome source '${name}' is not yet supported`);
  return provider;
}
