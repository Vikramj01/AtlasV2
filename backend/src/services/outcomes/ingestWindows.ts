/**
 * CRM Outcome Integration — destination ingest-window constants (§9.3 of
 * docs/prd/crm-outcome-integration.md).
 *
 * These bound how old a CRM stage-change event can be at delivery time
 * before a destination will accept it. `outcomeDelivery.ts` (Sprint 5) reads
 * these to decide `crm_outcome_events.delivery_status = 'skipped_window'`
 * instead of delivering an outcome the destination would silently drop.
 *
 * B2B sales cycles routinely exceed every one of these windows — that is a
 * real, expected limitation of this feature (see the PRD's Risks table),
 * not a bug to work around by lying about the timestamp.
 *
 * VERIFICATION NOTE: this sandbox's network egress proxy blocks direct
 * fetches to support.google.com, developers.facebook.com, and
 * learn.microsoft.com (the same class of restriction the OpenAI Ads sprint
 * hit against developers.openai.com). These figures were verified via live
 * web search against current indexed copies of each vendor's own docs on
 * 2026-09-19, not from training data. The Data Manager API Discovery
 * Document itself (datamanager.googleapis.com/$discovery/rest?version=v1)
 * was independently re-fetched directly and documents no event-age field on
 * events:ingest — these limits are Google Ads-side policy sitting in front
 * of that API, not a DMA schema constraint. Re-verify by direct fetch
 * before this reaches a live client, per Key Technical Decision §14/§23's
 * standing instruction on this class of figure.
 */

export type GoogleAdsIngestMethod = 'click_id' | 'enhanced_conversions_for_leads';

/**
 * Google Ads offline conversion import windows, measured from the last
 * click (not from when the CRM stage changed).
 *
 * Source: Google Ads Help, "About offline conversion imports"
 * (support.google.com/google-ads/answer/2998031) — click-ID based imports
 * older than 90 days from the associated last click are not imported.
 *
 * Source: Google Ads Help, "About enhanced conversions for leads"
 * (support.google.com/google-ads/answer/15713840) — hashed-PII based
 * uploads older than 63 days from the associated last click are not
 * imported. This is the realistic path for most CRM outcomes, since a B2B
 * lead is more often identity-resolved via hashed email than a surviving
 * click ID (see identityResolver.ts's resolution order, §6.3).
 *
 * Verified 2026-09-19. Also confirmed: Google's June 15 2026 migration of
 * both import paths onto the Data Manager API (off the Google Ads API) has
 * already taken effect, consistent with googleOfflineUpload.ts already
 * targeting DMA events:ingest for delivery.
 */
export const GOOGLE_ADS_INGEST_WINDOW_DAYS: Record<GoogleAdsIngestMethod, number> = {
  click_id: 90,
  enhanced_conversions_for_leads: 63,
};

/**
 * Meta Conversions API offline/server-sourced event window, measured from
 * event_time.
 *
 * Source: Meta for Developers, "Sending Offline Events Using the
 * Conversions API"
 * (developers.facebook.com/documentation/ads-commerce/conversions-api/offline-events)
 * — events older than 62 days are still accepted with a 2xx response but
 * never attach to attribution or feed the learning phase; Meta surfaces no
 * error for this case. Do not treat a 2xx as proof of a useful delivery for
 * an event this old — outcomeDelivery.ts must apply this window itself
 * rather than trusting Meta's response code.
 *
 * Verified 2026-09-19.
 */
export const META_OFFLINE_INGEST_WINDOW_DAYS = 62;

/**
 * LinkedIn Conversions API window on `conversionHappenedAt`.
 *
 * Source: Microsoft Learn, "Conversions API"
 * (learn.microsoft.com/en-us/linkedin/marketing/integrations/ads-reporting/conversions-api,
 * view=li-lms-2026-08) — conversionHappenedAt must be a valid epoch
 * timestamp that occurred within the past 90 days.
 *
 * Verified 2026-09-19. Also confirmed the existing LINKEDIN_VERSION =
 * '202608' pin (linkedinDelivery.ts, linkedInAdsConnector.ts) is still live
 * under LinkedIn's one-year sunset policy — no version bump required by
 * this PRD.
 */
export const LINKEDIN_INGEST_WINDOW_DAYS = 90;
