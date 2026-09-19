/**
 * outcomeDelivery — routes a resolved CRM outcome to Google/Meta/LinkedIn.
 * docs/prd/crm-outcome-integration.md §4.3/§4.4/§8/§9.
 *
 * Called synchronously from crmSyncOrchestrator.ts's per-record loop, in
 * the same pass that resolved identity — never from a separate queue or
 * against an already-persisted row. This is not a style choice: the raw
 * (unhashed) identity values needed to actually deliver are never
 * persisted on crm_outcome_events (§5.4's PII rule — only property NAMES
 * are stored), so by the time a row exists in the DB, nothing could hash
 * and deliver it even if it wanted to. The caller MUST have already
 * checked findExistingOutcomeKeys() (crmQueries.ts) before calling this —
 * re-delivering an already-delivered outcome on an overlapping sync
 * window is not "idempotent," it's a duplicate conversion sent to a live
 * ad platform.
 *
 * Three destinations, three different mechanisms, matching §4.3's diagram
 * exactly:
 *   - Google: googleOfflineUpload.ts's uploadOfflineConversions() — NOT
 *     googleDelivery.ts's live-pixel path. A CRM outcome has no live
 *     browser session, so it is architecturally an offline conversion,
 *     the same category as a CSV-uploaded one, and Enhanced Conversions
 *     for Leads (the hashed-PII path §6.3 point 3 names) is specifically
 *     an offline-import mechanism. An ad-hoc OfflineConversionConfig/Row
 *     pair is built per call (never persisted) since real
 *     offline_conversion_configs rows are 1-per-org, not 1-per-ladder-stage.
 *   - Meta/LinkedIn: pipeline.ts's processServerSourcedEvent() (§4.4) — the
 *     documented no-live-browser-session exception, same path Shopify's
 *     webhooks use. event_name is set directly from the stage mapping's
 *     own per-destination column for Meta (meta_event_name); LinkedIn has
 *     no equivalent per-event override in linkedinDelivery.ts's existing
 *     resolveConversionId() — it always routes by matching
 *     event.event_name against the org's own LinkedIn provider
 *     conversion_routes, so this sends atlas_event_name and relies on the
 *     operator having a matching conversion_routes entry configured
 *     (crm_stage_mappings.linkedin_conversion_id is informational for the
 *     ladder UI, not itself read here — LinkedIn's routing mechanism, "now
 *     fed" per the PRD, doesn't accept a directly-passed conversion_id).
 *
 * Consent (§8): if the record's atlas_event_id property resolved a real
 * capi_events row, that row's consent_state is inherited and re-checked
 * per destination via pipeline.ts's isConsentGranted() (exported for this
 * purpose) — the same per-category logic a live event would have used, so
 * a lead consent_blocked on capture for e.g. Google (analytics denied)
 * stays blocked for Google even if Meta's marketing category was granted.
 * If no original event is resolvable, the outcome is delivered as
 * genuinely server-sourced with no consent gate at all — the same
 * documented exception Shopify's webhook path uses (Key Technical
 * Decision §15) — since there is no consent decision to inherit and no
 * live session to have captured one from directly.
 *
 * Ingest windows (§9.3, ingestWindows.ts): checked per destination before
 * attempting delivery. An outcome past the verified window is recorded
 * skipped_window and never attempted — never delivered "in the hope it
 * lands" per the PRD's explicit instruction.
 *
 * PII (§8, acceptance criterion #13): every raw value here (email, phone,
 * click IDs) lives only in local variables for the duration of this call.
 * Never logged, never written to crm_outcome_events, never passed to a
 * queue.
 */

import { listProviders, getProvider as getCapiProviderConfig, getCAPIEventByAtlasEventId } from '@/services/database/capiQueries';
import { safeDecryptCredentials } from '@/services/capi/credentials';
import { processServerSourcedEvent, isConsentGranted } from '@/services/capi/pipeline';
import { uploadOfflineConversions } from '@/services/offline-conversions/googleOfflineUpload';
import { supabaseAdmin } from '@/services/database/supabase';
import { GOOGLE_ADS_INGEST_WINDOW_DAYS, META_OFFLINE_INGEST_WINDOW_DAYS, LINKEDIN_INGEST_WINDOW_DAYS } from './ingestWindows';
import type { ResolvedIdentity } from './identityResolver';
import type { AtlasEvent, GoogleCredentials } from '@/types/capi';
import type { ConsentDecisions } from '@/types/consent';
import type { CrmStageMapping, CrmDeliveryStatus } from '@/types/crm';
import type { OfflineConversionRow, OfflineConversionConfig } from '@/types/offline-conversions';
import logger from '@/utils/logger';

export interface OutcomeDeliveryInput {
  organization_id: string;
  event_id: string; // deterministic — same value as crm_outcome_events.event_id
  stage_changed_at: string; // ISO
  conversion_value: number | null;
  currency: string | null;
  identity: ResolvedIdentity;
}

export interface OutcomeDeliveryResult {
  status: CrmDeliveryStatus;
  detail: Record<string, unknown>;
  delivered_at: string | null;
}

interface PerDestinationOutcome {
  status: 'delivered' | 'skipped_window' | 'dedup_skipped' | 'failed';
  window_days?: number;
  reason?: string;
}

function isOlderThanWindow(isoTimestamp: string, windowDays: number): boolean {
  const ageMs = Date.now() - new Date(isoTimestamp).getTime();
  return ageMs > windowDays * 24 * 60 * 60 * 1000;
}

function buildUserData(identity: ResolvedIdentity): AtlasEvent['user_data'] {
  const v = identity.values;
  return {
    email: v.email,
    phone: v.phone,
    gclid: v.gclid,
    wbraid: v.wbraid,
    gbraid: v.gbraid,
    ttclid: v.ttclid,
    oppref: v.oppref,
  };
}

function buildSyntheticEvent(
  eventName: string,
  input: OutcomeDeliveryInput,
  consentState: ConsentDecisions | null,
): AtlasEvent {
  return {
    event_id: input.event_id,
    event_name: eventName,
    // No live page — a CRM stage change has no browser session (§4.4).
    event_time: Math.floor(new Date(input.stage_changed_at).getTime() / 1000),
    event_source_url: '',
    action_source: 'system_generated',
    user_data: buildUserData(input.identity),
    custom_data: { value: input.conversion_value ?? undefined, currency: input.currency ?? undefined },
    consent_state: (consentState ?? {}) as ConsentDecisions,
  };
}

// Mirrors refundDelivery.ts's getActiveGoogleCredentials() — same query,
// duplicated locally rather than exported cross-module for a single
// two-field lookup, consistent with how this codebase already tolerates
// small per-site credential lookups (e.g. connectionQueries.ts vs.
// tokenManager.ts's own resolution).
async function getActiveGoogleCredentials(orgId: string): Promise<GoogleCredentials | null> {
  const { data, error } = await supabaseAdmin
    .from('capi_providers')
    .select('credentials')
    .eq('organization_id', orgId)
    .eq('provider', 'google')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return safeDecryptCredentials((data as { credentials: unknown }).credentials) as GoogleCredentials;
}

async function deliverGoogle(
  orgId: string,
  mapping: CrmStageMapping,
  input: OutcomeDeliveryInput,
  consentState: ConsentDecisions | null,
): Promise<PerDestinationOutcome> {
  // click_id vs. Enhanced Conversions for Leads carry different verified
  // windows (§9.3) — click_id here really means "a surviving gclid",
  // gbraid/wbraid resolve identity.method === 'click_id' too but have no
  // ad-identifier field on the DMA event this reuses (see the row-building
  // note below), so they fall through to the hashed-PII path in practice.
  const windowDays = input.identity.method === 'click_id'
    ? GOOGLE_ADS_INGEST_WINDOW_DAYS.click_id
    : GOOGLE_ADS_INGEST_WINDOW_DAYS.enhanced_conversions_for_leads;
  if (isOlderThanWindow(input.stage_changed_at, windowDays)) {
    return { status: 'skipped_window', window_days: windowDays };
  }

  if (consentState && !isConsentGranted({ consent_state: consentState } as AtlasEvent, 'google')) {
    return { status: 'failed', reason: 'consent_blocked_at_capture' };
  }

  const creds = await getActiveGoogleCredentials(orgId);
  if (!creds) return { status: 'failed', reason: 'no_active_google_connection' };

  // Ad-hoc, never-persisted config/row pair — uploadOfflineConversions()
  // only ever reads google_customer_id/conversion_action_id off the
  // config (buildOfflineDestinations()) and row_index/raw_email/raw_phone/
  // raw_gclid/conversion_time/conversion_value/currency/order_id off the
  // row (buildDMAEventFromRow()); every other required field below is
  // structurally-required but unread by this call path.
  const offlineConfig = {
    id: 'crm-outcome',
    organization_id: orgId,
    provider_type: 'google',
    google_customer_id: creds.customer_id,
    conversion_action_id: mapping.google_conversion_action_id,
    conversion_action_name: null,
    meta_event_name: null,
    column_mapping: {},
    default_currency: input.currency ?? 'USD',
    default_conversion_value: null,
    status: 'active',
    error_message: null,
    capi_provider_id: null,
    created_at: '',
    updated_at: '',
  } as unknown as OfflineConversionConfig;

  const row = {
    id: input.event_id,
    upload_id: 'crm-outcome',
    organization_id: orgId,
    row_index: 0,
    raw_email: input.identity.values.email ?? null,
    raw_phone: input.identity.values.phone ?? null,
    // buildDMAEventFromRow() only ever reads raw_gclid for adIdentifiers —
    // gbraid/wbraid have no field on this call path (a real, documented
    // gap, not fixed here).
    raw_gclid: input.identity.values.gclid ?? null,
    raw_fbclid: null,
    hashed_email: null,
    hashed_phone: null,
    conversion_time: input.stage_changed_at,
    conversion_value: input.conversion_value,
    currency: input.currency,
    order_id: null,
    status: 'pending',
    validation_errors: null,
    validation_warnings: null,
    google_error_code: null,
    google_error_message: null,
    uploaded_at: null,
    created_at: '',
  } as unknown as OfflineConversionRow;

  try {
    const result = await uploadOfflineConversions([row], offlineConfig, creds, creds.oauth_access_token);
    const rowResult = result.row_results[0];
    if (rowResult?.status === 'uploaded') return { status: 'delivered' };
    return { status: 'failed', reason: rowResult?.error_message ?? 'upload_rejected' };
  } catch (err) {
    return { status: 'failed', reason: err instanceof Error ? err.message : String(err) };
  }
}

async function deliverViaGenericPipeline(
  provider: 'meta' | 'linkedin',
  orgId: string,
  eventName: string,
  input: OutcomeDeliveryInput,
  consentState: ConsentDecisions | null,
): Promise<PerDestinationOutcome> {
  const windowDays = provider === 'meta' ? META_OFFLINE_INGEST_WINDOW_DAYS : LINKEDIN_INGEST_WINDOW_DAYS;
  if (isOlderThanWindow(input.stage_changed_at, windowDays)) {
    return { status: 'skipped_window', window_days: windowDays };
  }

  const event = buildSyntheticEvent(eventName, input, consentState);

  if (consentState && !isConsentGranted(event, provider)) {
    return { status: 'failed', reason: 'consent_blocked_at_capture' };
  }

  const providers = await listProviders(orgId);
  const active = providers.find((p) => p.provider === provider && p.status === 'active');
  if (!active) return { status: 'failed', reason: `no_active_${provider}_connection` };
  const fullConfig = await getCapiProviderConfig(active.id, orgId);
  if (!fullConfig) return { status: 'failed', reason: `no_active_${provider}_connection` };

  try {
    const result = await processServerSourcedEvent(event, fullConfig);
    if (result.status === 'delivered') return { status: 'delivered' };
    if (result.status === 'dedup_skipped') return { status: 'dedup_skipped' };
    return { status: 'failed', reason: result.error_message ?? result.status };
  } catch (err) {
    return { status: 'failed', reason: err instanceof Error ? err.message : String(err) };
  }
}

function aggregateStatus(perDestination: Record<string, PerDestinationOutcome>): CrmDeliveryStatus {
  const statuses = Object.values(perDestination).map((d) => d.status);
  if (statuses.length === 0) return 'pending';
  if (statuses.every((s) => s === 'delivered')) return 'delivered';
  if (statuses.every((s) => s === 'skipped_window')) return 'skipped_window';
  if (statuses.every((s) => s === 'dedup_skipped')) return 'dedup_skipped';
  if (statuses.some((s) => s === 'delivered')) return 'partial';
  return 'failed';
}

export async function deliverOutcome(
  mapping: CrmStageMapping,
  input: OutcomeDeliveryInput,
): Promise<OutcomeDeliveryResult> {
  const attemptGoogle = !!mapping.google_conversion_action_id;
  const attemptMeta = !!mapping.meta_event_name;
  const attemptLinkedIn = !!mapping.linkedin_conversion_id;

  if (!attemptGoogle && !attemptMeta && !attemptLinkedIn) {
    // Nothing configured for this stage yet — leave 'pending' rather than
    // asserting a delivery outcome for a destination nobody set up.
    return { status: 'pending', detail: {}, delivered_at: null };
  }

  let consentState: ConsentDecisions | null = null;
  const atlasEventIdValue = input.identity.values.event_id;
  if (atlasEventIdValue) {
    try {
      const original = await getCAPIEventByAtlasEventId(input.organization_id, atlasEventIdValue);
      if (original?.consent_state) consentState = original.consent_state as ConsentDecisions;
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), eventId: input.event_id },
        'CRM outcome delivery: failed to resolve original capi_events row for consent inheritance — proceeding as server-sourced',
      );
    }
  }

  const detail: Record<string, PerDestinationOutcome> = {};

  if (attemptGoogle) {
    detail.google = await deliverGoogle(input.organization_id, mapping, input, consentState);
  }
  if (attemptMeta) {
    detail.meta = await deliverViaGenericPipeline('meta', input.organization_id, mapping.meta_event_name!, input, consentState);
  }
  if (attemptLinkedIn) {
    detail.linkedin = await deliverViaGenericPipeline('linkedin', input.organization_id, mapping.atlas_event_name, input, consentState);
  }

  const status = aggregateStatus(detail);
  return {
    status,
    detail,
    delivered_at: status === 'delivered' || status === 'partial' ? new Date().toISOString() : null,
  };
}
