/**
 * Source registry — the single map from CrmProviderName to its CrmProvider
 * implementation, shared by outcomes.ts (routes) and syncOrchestrator.ts
 * (Sprint 4) so there's exactly one place that knows which sources exist.
 * Salesforce joined in Sprint 10. File renamed from providerRegistry.ts
 * (docs/prd/universal-outcome-ingestion.md Phase 1) — renaming the map's
 * own CrmProvider/CrmProviderName types is Phase 2's job.
 */

import { hubspotClient } from './sources/hubspotClient';
import { salesforceClient } from './sources/salesforceClient';
import type { CrmProvider, CrmProviderName } from './sources/types';

const PROVIDERS: Partial<Record<CrmProviderName, CrmProvider>> = {
  hubspot: hubspotClient,
  salesforce: salesforceClient,
};

export function getProvider(name: CrmProviderName): CrmProvider {
  const provider = PROVIDERS[name];
  if (!provider) throw new Error(`CRM provider '${name}' is not yet supported`);
  return provider;
}
