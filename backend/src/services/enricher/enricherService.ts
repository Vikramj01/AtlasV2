import crypto from 'crypto';
import { ingestAudienceMembers } from '@/integrations/google/dmaClient';
import { supabaseAdmin } from '@/services/database/supabase';
import logger from '@/utils/logger';
import { logUsage } from '@/services/usage/usageLogger';
import type { DMAUserIdData, DMADestination } from '@/integrations/google/dmaTypes';

export interface EnricherContact {
  email?: string;
  phone?: string;
  first_name?: string;
  last_name?: string;
  zip?: string;
  country?: string;
}

export interface EnricherDestination {
  type: 'GOOGLE_ADS' | 'GA4' | 'DV360' | 'CM360';
  customerId?: string;   // GOOGLE_ADS
  propertyId?: string;   // GA4
  advertiserId?: string; // DV360 / CM360
}

export interface EnricherRunResult {
  run_id: string;
  record_count: number;
  matched_count: number;
  failed_count: number;
  match_rate: number;
  member_errors: Array<{ index: number; code: string; message: string }>;
}

// SHA-256 helpers (same logic as customerMatch.ts)
function sha256(v: string): string {
  return crypto.createHash('sha256').update(v).digest('hex');
}
function hashEmail(raw: string) { return sha256(raw.trim().toLowerCase()); }
function hashPhone(raw: string) {
  const n = raw.replace(/[^\d+]/g, '');
  return sha256(n.startsWith('+') ? n : `+${n}`);
}
function hashName(raw: string) { return sha256(raw.trim().toLowerCase()); }

function cleanCustomerId(id: string) { return id.replace(/-/g, ''); }

function buildUserIdData(contact: EnricherContact): DMAUserIdData {
  const data: DMAUserIdData = {};
  if (contact.email) data.hashedEmail = hashEmail(contact.email);
  if (contact.phone) data.hashedPhoneNumber = hashPhone(contact.phone);
  if (contact.first_name || contact.last_name || contact.zip || contact.country) {
    data.addressInfo = {
      ...(contact.first_name && { hashedFirstName: hashName(contact.first_name) }),
      ...(contact.last_name && { hashedLastName: hashName(contact.last_name) }),
      ...(contact.zip && { postalCode: contact.zip }),
      ...(contact.country && { countryCode: contact.country }),
    };
  }
  return data;
}

function buildDestinations(dests: EnricherDestination[]): DMADestination[] {
  return dests.map((d) => ({
    type: d.type,
    ...(d.customerId && { customerId: cleanCustomerId(d.customerId) }),
    ...(d.propertyId && { propertyId: d.propertyId }),
    ...(d.advertiserId && { advertiserId: d.advertiserId }),
  }));
}

export async function runAudienceEnricher(
  orgId: string,
  destinations: EnricherDestination[],
  contacts: EnricherContact[],
  operationType: 'CREATE' | 'REMOVE' = 'CREATE',
): Promise<EnricherRunResult> {
  // 1. Create run row
  const { data: runRow, error: insertErr } = await supabaseAdmin
    .from('enricher_runs')
    .insert({
      org_id: orgId,
      ingest_type: 'audience_members',
      destinations: destinations,
      operation_type: operationType,
      status: 'processing',
      record_count: contacts.length,
      triggered_by: 'manual',
    })
    .select('id')
    .single();

  if (insertErr || !runRow) {
    throw new Error(`Failed to create enricher_runs row: ${insertErr?.message}`);
  }
  const runId: string = (runRow as { id: string }).id;

  try {
    // 2. Build DMA request
    const audienceMembers = contacts.map(buildUserIdData);
    const dmaDestinations = buildDestinations(destinations);

    // 3. Call DMA
    const response = await ingestAudienceMembers(orgId, {
      audienceMembers,
      destinations: dmaDestinations,
      operationType,
    });

    // 4. Parse per-member results
    const errorMap = new Map(
      (response.memberResults ?? [])
        .filter((r) => r.error)
        .map((r) => [r.memberIndex, r.error!]),
    );

    const memberErrors = Array.from(errorMap.entries()).map(([index, err]) => ({
      index,
      code: String(err.code),
      message: err.message,
    }));

    const failedCount = errorMap.size;
    const matchedCount = contacts.length - failedCount;
    const matchRate =
      contacts.length > 0 ? Math.round((matchedCount / contacts.length) * 10000) / 100 : 0;

    // 5. Update run row
    await supabaseAdmin
      .from('enricher_runs')
      .update({
        status: 'completed',
        matched_count: matchedCount,
        failed_count: failedCount,
        match_rate: matchRate,
        dma_response: response as unknown as Record<string, unknown>,
      })
      .eq('id', runId);

    void logUsage({
      org_id: orgId,
      event_type: 'dma_enricher_event',
      dma_member_count: contacts.length,
      dma_matched_count: matchedCount,
      metadata: { run_id: runId, destinations: destinations.length },
    });

    logger.info(
      { orgId, runId, recordCount: contacts.length, matchedCount, failedCount, matchRate },
      'Enricher run completed',
    );

    return {
      run_id: runId,
      record_count: contacts.length,
      matched_count: matchedCount,
      failed_count: failedCount,
      match_rate: matchRate,
      member_errors: memberErrors,
    };
  } catch (err) {
    // Update run row with error
    await supabaseAdmin
      .from('enricher_runs')
      .update({
        status: 'failed',
        error_message: err instanceof Error ? err.message : String(err),
      })
      .eq('id', runId);
    throw err;
  }
}
