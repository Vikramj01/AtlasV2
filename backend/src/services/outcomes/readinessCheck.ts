/**
 * CRM identity readiness check — docs/prd/crm-outcome-integration.md §6.2.
 *
 * A properties-exist check alone would pass every failure mode this is
 * designed to catch (PRD's own words) — the dangerous state is a portal
 * where the Atlas-namespaced properties were created but nothing ever
 * writes to them, which looks configured and delivers nothing. So this
 * always follows a two-step process: which expected properties exist on
 * the object, then whether a sample of recently-changed records actually
 * has data in any of them.
 *
 * Four verdicts (all must render without "missing"/"broken"-style absolute
 * language if ever surfaced in a report — outputLint.ts's banned-token list,
 * Key Technical Decision §18):
 *   READY                     — required properties exist and at least one
 *                                has a value on the sample.
 *   PROPERTIES_PRESENT_NO_DATA — properties exist, sample is all empty.
 *                                Blocks sync_enabled (enforced in crm.ts's
 *                                PATCH handler, not here).
 *   PROPERTIES_ABSENT        — none of the expected properties exist yet.
 *   NOT_OBSERVED             — could not sample (API error, or genuinely no
 *                                records changed in the sampling window).
 *                                Not a failure — absence is never asserted.
 */

import type { CrmProvider, DecryptedTokens, OutcomeObjectType, CrmRecord } from './sources/types';
import { resolveIdentityPropertyMap, isPresent } from './identityResolver';

export type ReadinessVerdict = 'READY' | 'PROPERTIES_PRESENT_NO_DATA' | 'PROPERTIES_ABSENT' | 'NOT_OBSERVED';

export interface ReadinessResult {
  verdict: ReadinessVerdict;
  present_properties: string[];
  missing_properties: string[];
  sample_size: number;
  message: string;
}

// A sample of the most-recently-changed records is enough to tell "wired"
// from "not wired" — this isn't a statistical estimate of capture rate, so
// a modest, cheap sample is the right size (§6.2 just says "a sample").
const SAMPLE_SIZE = 25;
// Wide enough to catch a client whose capture only fires occasionally, not
// so wide it reads as "all-time" (fetchChangedRecords is a modified-since
// search, not a full scan — Key Technical Decision-adjacent constraint from
// the CrmProvider interface itself, §4.2).
const SAMPLE_WINDOW_DAYS = 90;

function readinessMessage(verdict: ReadinessVerdict): string {
  switch (verdict) {
    case 'READY':
      return 'Atlas identity properties are present and populated on recently changed records.';
    case 'PROPERTIES_PRESENT_NO_DATA':
      return 'These properties exist on the object, but every sampled record left them empty — capture likely isn\'t wired from the client\'s form into the CRM yet.';
    case 'PROPERTIES_ABSENT':
      return 'None of the expected Atlas identity properties exist on this object yet. Use the setup helper to create them.';
    case 'NOT_OBSERVED':
      return 'Could not sample recent records to check for identity data — either no records changed in the sampling window, or this connection lacks read access to sample one.';
  }
}

export async function runReadinessCheck(
  provider: CrmProvider,
  tokens: DecryptedTokens,
  object: OutcomeObjectType,
  identityPropertyMap: Record<string, string> | null | undefined,
): Promise<ReadinessResult> {
  const expectedProperties = Array.from(new Set(Object.values(resolveIdentityPropertyMap(identityPropertyMap, provider.name))));

  const existingProperties = await provider.listProperties(tokens, object);
  const existingNames = new Set(existingProperties.map((p) => p.name));

  const presentProperties = expectedProperties.filter((name) => existingNames.has(name));
  const missingProperties = expectedProperties.filter((name) => !existingNames.has(name));

  if (presentProperties.length === 0) {
    const verdict: ReadinessVerdict = 'PROPERTIES_ABSENT';
    return { verdict, present_properties: presentProperties, missing_properties: missingProperties, sample_size: 0, message: readinessMessage(verdict) };
  }

  let sample: CrmRecord[];
  try {
    sample = await collectSample(provider, tokens, object, presentProperties);
  } catch {
    const verdict: ReadinessVerdict = 'NOT_OBSERVED';
    return { verdict, present_properties: presentProperties, missing_properties: missingProperties, sample_size: 0, message: readinessMessage(verdict) };
  }

  if (sample.length === 0) {
    const verdict: ReadinessVerdict = 'NOT_OBSERVED';
    return { verdict, present_properties: presentProperties, missing_properties: missingProperties, sample_size: 0, message: readinessMessage(verdict) };
  }

  const hasData = sample.some((record) => presentProperties.some((name) => isPresent(record.properties[name])));
  const verdict: ReadinessVerdict = hasData ? 'READY' : 'PROPERTIES_PRESENT_NO_DATA';

  return {
    verdict,
    present_properties: presentProperties,
    missing_properties: missingProperties,
    sample_size: sample.length,
    message: readinessMessage(verdict),
  };
}

async function collectSample(
  provider: CrmProvider,
  tokens: DecryptedTokens,
  object: OutcomeObjectType,
  propertyNames: string[],
): Promise<CrmRecord[]> {
  const until = new Date();
  const since = new Date(until.getTime() - SAMPLE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const sample: CrmRecord[] = [];
  for await (const record of provider.fetchChangedRecords(tokens, object, since, until, propertyNames)) {
    sample.push(record);
    if (sample.length >= SAMPLE_SIZE) break;
  }
  return sample;
}
