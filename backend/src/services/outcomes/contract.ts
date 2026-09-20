/**
 * The outcome contract — docs/prd/universal-outcome-ingestion.md §5.1.
 *
 * `OutcomeRecord` is a versioned, public wire contract: external senders
 * (Phase 3's inbound webhook, a future Zapier/Make action, a sheet-sync
 * column mapping) will hold this shape, correctly or otherwise, forever.
 * Strict from day one — reject on schema violation with a field-level
 * error, never coerce, never silently drop an unrecognised field, never
 * infer a missing timestamp. Atlas can fix its own connectors; it cannot
 * fix an external sender's payload after the fact, and a coercion applied
 * once becomes a behaviour that can never be safely removed.
 *
 * Scope note (Phase 2 implementation deviation, recorded in full in the
 * PRD's own §12): `OutcomeSource.fetchChangedRecords()` (sources/types.ts)
 * deliberately still yields `CrmRecord`, not `OutcomeRecord` — the pull
 * sync pipeline (syncOrchestrator.ts) has real, tested behaviour (a
 * no-stage record's effect on `records_processed`, raw per-config
 * `identity_property_map` resolution) that depends on CrmRecord's more
 * permissive, nullable shape in a way forcing OutcomeRecord's strict,
 * non-nullable shape onto it would silently have changed. Phase 2 shipped
 * this module with no real consumer yet; Phase 3's inbound webhook
 * (services/outcomes/webhookIngest.ts) is its first — a payload posted to
 * `POST /api/outcomes/webhook/:configId` is validated here directly, and
 * resolveContractIdentity() below (Phase 3 addition) turns its already-typed
 * `identity` object into the same ResolvedIdentity shape identityResolver.ts
 * produces from raw CRM properties, so outcomeDelivery.ts/valueLadder.ts
 * need no source-specific branching to consume either.
 */
import { z } from 'zod';
import type { IdentityKey, IdentityMethod, ResolvedIdentity } from './identityResolver';

export const OUTCOME_CONTRACT_VERSION = '1.0.0';

// Every identity key this codebase's downstream pipeline (identityResolver.ts)
// already understands — see its own IdentityKey union, which this
// deliberately mirrors rather than diverges from. A sender supplies
// whichever of these it has; identityResolver.ts's existing priority order
// (click ID > atlas_event_id > hashed email > hashed phone > unresolved)
// is unaffected by this contract, since it operates downstream of it.
const OutcomeIdentitySchema = z
  .object({
    gclid: z.string().min(1).optional(),
    gbraid: z.string().min(1).optional(),
    wbraid: z.string().min(1).optional(),
    fbclid: z.string().min(1).optional(),
    ttclid: z.string().min(1).optional(),
    li_fat_id: z.string().min(1).optional(),
    msclkid: z.string().min(1).optional(),
    oppref: z.string().min(1).optional(),
    atlas_event_id: z.string().min(1).optional(),
    email: z.string().min(1).optional(),
    phone: z.string().min(1).optional(),
  })
  .strict()
  .refine((identity) => Object.values(identity).some((v) => v !== undefined), {
    message: 'At least one identity key is required — an outcome with no identity signal can never be delivered.',
  });

export const OutcomeRecordSchema = z
  .object({
    source_record_id: z.string().min(1, 'source_record_id must be a non-empty string'),
    source_stage_id: z.string().min(1, 'source_stage_id must be a non-empty string'),
    // ISO 8601, offset or 'Z' — "when the stage change occurred, not when
    // it was sent" (§5.1). Never defaulted to "now" on a missing/invalid
    // value; that would be exactly the "infer a missing timestamp"
    // coercion this contract's own header forbids.
    stage_changed_at: z.string().datetime({ offset: true, message: 'stage_changed_at must be an ISO 8601 timestamp' }),
    identity: OutcomeIdentitySchema,
    value: z.number().finite().optional(),
    // ISO 4217 — three uppercase letters. Not validated against a real
    // currency-code list (that list changes independently of this
    // contract); shape-only, matching every other currency field in this
    // codebase (e.g. outcome_source_configs.default_currency).
    currency: z.string().regex(/^[A-Z]{3}$/, 'currency must be a 3-letter ISO 4217 code').optional(),
    source_object: z.string().min(1).optional(),
  })
  .strict();

export type OutcomeRecord = z.infer<typeof OutcomeRecordSchema>;

export interface OutcomeValidationError {
  /** Dot-path into the payload, e.g. "identity.gclid" or "stage_changed_at". Empty string for a whole-object error (e.g. an unrecognised top-level field). */
  field: string;
  message: string;
}

export interface OutcomeValidationResult {
  valid: boolean;
  /** Present only when valid is true — the parsed, typed record. */
  record?: OutcomeRecord;
  /** Empty when valid is true. */
  errors: OutcomeValidationError[];
}

/**
 * Validates an arbitrary payload against the outcome contract. Never
 * throws — a malformed payload is exactly the case this function exists to
 * describe, not to except on. Every Zod issue becomes one field-level
 * error; an unrecognised top-level or nested field surfaces via Zod's own
 * 'unrecognized_keys' issue (from .strict()) rather than being silently
 * stripped.
 */
export function validateOutcomeRecord(payload: unknown): OutcomeValidationResult {
  const result = OutcomeRecordSchema.safeParse(payload);
  if (result.success) {
    return { valid: true, record: result.data, errors: [] };
  }
  const errors: OutcomeValidationError[] = result.error.issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message,
  }));
  return { valid: false, errors };
}

// Contract identity keys that map 1:1 onto identityResolver.ts's IdentityKey
// union, except atlas_event_id -> event_id (different name, same concept).
const CONTRACT_TO_IDENTITY_KEY: Array<[keyof OutcomeRecord['identity'], IdentityKey]> = [
  ['gclid', 'gclid'], ['gbraid', 'gbraid'], ['wbraid', 'wbraid'],
  ['fbclid', 'fbclid'], ['ttclid', 'ttclid'], ['li_fat_id', 'li_fat_id'],
  ['msclkid', 'msclkid'], ['oppref', 'oppref'],
  ['atlas_event_id', 'event_id'], ['email', 'email'], ['phone', 'phone'],
];

const CLICK_ID_IDENTITY_KEYS: IdentityKey[] = ['gclid', 'gbraid', 'wbraid', 'fbclid', 'ttclid', 'li_fat_id', 'msclkid', 'oppref'];

/**
 * Turns an already-validated OutcomeRecord's `identity` object into the
 * exact ResolvedIdentity shape identityResolver.ts's resolveIdentity()
 * produces from raw CRM properties, so outcomeDelivery.ts/valueLadder.ts
 * need no source-specific branching to consume either. No raw-property
 * lookup here at all — the contract sender already supplies typed identity
 * fields directly, which is the whole point of the contract.
 *
 * A bare atlas_event_id (no click id, no email, no phone) resolves to
 * 'unresolved' here, not 'click_id' — see this file's own header and
 * deliveryGate.ts's header for why: treating it as Tier 1 without actually
 * joining it to a real capi_events row would assert a stronger identity
 * than this function can verify, and the pull-sync path has never built
 * that join either (syncOrchestrator.ts always passes originalEvent: null).
 */
export function resolveContractIdentity(identity: OutcomeRecord['identity']): ResolvedIdentity {
  const keysPresent: IdentityKey[] = [];
  const values: Partial<Record<IdentityKey, string>> = {};

  for (const [contractKey, identityKey] of CONTRACT_TO_IDENTITY_KEY) {
    const value = identity[contractKey];
    if (value !== undefined) {
      keysPresent.push(identityKey);
      values[identityKey] = value;
    }
  }

  let method: IdentityMethod;
  if (CLICK_ID_IDENTITY_KEYS.some((k) => keysPresent.includes(k))) {
    method = 'click_id';
  } else if (keysPresent.includes('email')) {
    method = 'hashed_email';
  } else if (keysPresent.includes('phone')) {
    method = 'hashed_phone';
  } else {
    method = 'unresolved';
  }

  return { method, keys_present: keysPresent, values };
}
