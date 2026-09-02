/**
 * Customer Match ingestion service
 *
 * Hashes contact PII (SHA-256) and calls the Google DMA
 * audienceMembers:ingest / audienceMembers:remove endpoints via dmaClient.
 * These are separate methods on the live API (confirmed against the raw
 * Discovery Document) — a prior version of this file sent a synthetic
 * `operationType` field to a single `:ingest` call for both, which the
 * live API doesn't recognize, so REMOVE never actually removed anyone.
 *
 * PII is NEVER logged — only aggregate counts are emitted.
 */

import { createHash } from 'crypto';
import { ingestAudienceMembers, removeAudienceMembers, DMAClientError } from '@/integrations/google/dmaClient';
import { buildAudienceMember } from '@/integrations/google/dmaEventBuilder';
import type { AddressFields } from '@/integrations/google/dmaEventBuilder';
import type { DMADestination, DMAAudienceMember } from '@/integrations/google/dmaTypes';
import logger from '@/utils/logger';
import { logUsage } from '@/services/usage/usageLogger';

export { DMAClientError };

export interface AudienceContact {
  email?: string;
  phone?: string;
  first_name?: string;
  last_name?: string;
  zip?: string;
  country?: string;
}

export interface AudienceIngestResult {
  record_count: number;
  matched_count: number;
  failed_count: number;
  member_errors: Array<{ index: number; code: string; message: string }>;
  raw_response: unknown;
}

// ── Hashing helpers ───────────────────────────────────────────────────────────

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hashEmail(email: string): string {
  return sha256(email.trim().toLowerCase());
}

function hashPhone(phone: string): string {
  // Normalise to E.164: strip everything except digits, then prepend '+' if missing.
  const digits = phone.replace(/[^\d+]/g, '').replace(/^\+?/, '+');
  return sha256(digits);
}

function hashName(name: string): string {
  return sha256(name.trim().toLowerCase());
}

/** Strip dashes from a Google Ads customer ID (e.g. "123-456-7890" → "1234567890"). */
function cleanCustomerId(customerId: string): string {
  return customerId.replace(/-/g, '');
}

// ── Contact → DMAAudienceMember ───────────────────────────────────────────────

function buildMember(contact: AudienceContact): DMAAudienceMember {
  const address: AddressFields = {
    ...(contact.first_name !== undefined && { givenName: hashName(contact.first_name) }),
    ...(contact.last_name !== undefined && { familyName: hashName(contact.last_name) }),
    ...(contact.zip !== undefined && { postalCode: contact.zip }),
    ...(contact.country !== undefined && { regionCode: contact.country }),
  };

  return buildAudienceMember({
    hashedEmail: contact.email ? hashEmail(contact.email) : undefined,
    hashedPhone: contact.phone ? hashPhone(contact.phone) : undefined,
    address: Object.keys(address).length > 0 ? address : undefined,
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function ingestCustomerMatchBatch(
  orgId: string,
  customerId: string,
  contacts: AudienceContact[],
  operationType: 'CREATE' | 'REMOVE',
): Promise<AudienceIngestResult> {
  const audienceMembers: DMAAudienceMember[] = contacts.map(buildMember);
  const destinations: DMADestination[] = [
    { operatingAccount: { accountId: cleanCustomerId(customerId), accountType: 'GOOGLE_ADS' } },
  ];

  const response = operationType === 'REMOVE'
    ? await removeAudienceMembers(orgId, { audienceMembers, destinations })
    : await ingestAudienceMembers(orgId, { audienceMembers, destinations });

  // Neither audienceMembers:ingest nor :remove return per-member results on
  // the live API (just { requestId }) — a successful call means the whole
  // batch was accepted for processing. See googleDelivery.ts's matching
  // comment on sendGoogleEvents for the full explanation of this API-wide
  // submit-confirmation-only response model.
  const record_count = contacts.length;
  const failed_count = 0;
  const matched_count = record_count;
  const member_errors: Array<{ index: number; code: string; message: string }> = [];

  logger.info(
    { orgId, operationType, record_count, requestId: response.requestId },
    'Customer Match batch submitted',
  );

  void logUsage({
    org_id: orgId,
    event_type: 'dma_ingest_event',
    dma_member_count: contacts.length,
    dma_matched_count: matched_count,
    metadata: { customer_id: customerId, operation_type: operationType },
  });

  return {
    record_count,
    matched_count,
    failed_count,
    member_errors,
    raw_response: response,
  };
}
