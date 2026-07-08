-- Canonical Event Identity — schema follow-up
--
-- 1. Re-scope the unique index on capi_events.event_id from org-wide to
--    per-provider. The CAPI pipeline mints one canonical atlas_event_id per
--    business event; the Meta/Google delivery adapters now legitimately
--    default their native event_id/orderId to that same canonical id when no
--    stronger platform-native key (fbc/gclid dedup hit) exists. That means
--    the same event_id string can now appear on multiple destination rows
--    (Meta + Google) for one fanned-out business event in the same org — the
--    prior (organization_id, event_id) uniqueness would reject the second
--    insert. Uniqueness per (organization_id, provider_config_id, event_id)
--    still catches genuine duplicate deliveries to the same destination.
DROP INDEX IF EXISTS idx_capi_events_org_event_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_capi_events_org_provider_event_id
  ON capi_events (organization_id, provider_config_id, event_id)
  WHERE event_id IS NOT NULL;

-- 2. native_id_field records which platform-native field the delivered
--    event_id/orderId was written into (e.g. 'event_id' for Meta, 'eventId'
--    for LinkedIn, 'transactionId' for Google), so the event trace view can
--    show identity was preserved across destinations without guessing from
--    the provider name alone. NULL for pre-migration rows and providers with
--    no native id concept (e.g. Amazon).
ALTER TABLE capi_events
  ADD COLUMN IF NOT EXISTS native_id_field TEXT;
