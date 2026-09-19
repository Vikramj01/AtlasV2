/**
 * Provider registry — the single map from CrmProviderName to its
 * CrmProvider implementation, shared by crm.ts (routes) and
 * crmSyncOrchestrator.ts (Sprint 4) so there's exactly one place that
 * knows which providers exist. Salesforce joined in Sprint 10.
 */

import { hubspotClient } from './providers/hubspotClient';
import { salesforceClient } from './providers/salesforceClient';
import type { CrmProvider, CrmProviderName } from './providers/types';

const PROVIDERS: Partial<Record<CrmProviderName, CrmProvider>> = {
  hubspot: hubspotClient,
  salesforce: salesforceClient,
};

export function getProvider(name: CrmProviderName): CrmProvider {
  const provider = PROVIDERS[name];
  if (!provider) throw new Error(`CRM provider '${name}' is not yet supported`);
  return provider;
}
