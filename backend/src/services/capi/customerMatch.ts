/**
 * Customer Match ingestion service
 *
 * Hashes contact PII (SHA-256) and calls the Google DMA
 * audiencemembers:ingest endpoint via dmaClient.
 *
 * PII is NEVER logged — only aggregate counts are emitted.
 */

import { createHash } from 'crypto';
import { ingestAudienceMembers, DMAClientError } from '@/integrations/google/dmaClient';
import type { DMAUserIdData } from '@/integrations/google/dmaTypes';
import logger from '@/utils/logger';

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

// ── Contact → DMAUserIdData ───────────────────────────────────────────────────

function buildUserIdData(contact: AudienceContact): DMAUserIdData {
  const member: DMAUserIdData = {};

  if (contact.email) {
    member.hashedEmail = hashEmail(contact.email);
  }

  if (contact.phone) {
    member.hashedPhoneNumber = hashPhone(contact.phone);
  }

  const hasAddressField =
    contact.first_name !== undefined ||
    contact.last_name !== undefined ||
    contact.zip !== undefined ||
    contact.country !== undefined;

  if (hasAddressField) {
    member.addressInfo = {
      ...(contact.first_name !== undefined && { hashedFirstName: hashName(contact.first_name) }),
      ...(contact.last_name !== undefined && { hashedLastName: hashName(contact.last_name) }),
      ...(contact.zip !== undefined && { postalCode: contact.zip }),
      ...(contact.country !== undefined && { countryCode: contact.country }),
    };
  }

  return member;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function ingestCustomerMatchBatch(
  orgId: string,
  customerId: string,
  contacts: AudienceContact[],
  operationType: 'CREATE' | 'REMOVE',
): Promise<AudienceIngestResult> {
  const audienceMembers: DMAUserIdData[] = contacts.map(buildUserIdData);

  const response = await ingestAudienceMembers(orgId, {
    audienceMembers,
    destinations: [
      {
        type: 'GOOGLE_ADS',
        customerId: cleanCustomerId(customerId),
      },
    ],
    operationType,
  });

  // Build an index → error map from memberResults
  const errorMap = new Map<number, { code: string; message: string }>();
  for (const result of response.memberResults ?? []) {
    if (result.error) {
      errorMap.set(result.memberIndex, {
        code: String(result.error.code),
        message: result.error.message,
      });
    }
  }

  const record_count = contacts.length;
  const failed_count = errorMap.size;
  const matched_count = record_count - failed_count;

  const member_errors = Array.from(errorMap.entries()).map(([index, err]) => ({
    index,
    code: err.code,
    message: err.message,
  }));

  logger.info(
    { orgId, record_count, matched_count, failed_count },
    'Customer Match batch ingested',
  );

  return {
    record_count,
    matched_count,
    failed_count,
    member_errors,
    raw_response: response,
  };
}
