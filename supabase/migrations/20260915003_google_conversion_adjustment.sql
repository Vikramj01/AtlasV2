-- Automated Google Ads conversion adjustments (spike outcome: viable).
--
-- Confirmed directly against Google Ads API reference docs (secondary
-- sources, since developers.google.com is network-blocked in this sandbox)
-- and independently re-verified against the live Data Manager API Discovery
-- Document (revision 20260904, newer than the 20260828 revision this
-- codebase last checked): DMA still has no adjustment capability, and every
-- source describing Google's 2026 migration waves scopes them specifically
-- to OfflineUserDataJobService/UserDataService (Customer Match, cut Apr 1)
-- and ConversionUploadService.UploadClickConversions (offline conversion
-- imports, cut Jun 15) — never to ConversionAdjustmentUploadService. So the
-- standard Google Ads API's uploadConversionAdjustments remains the correct,
-- unaffected path for automating this.
--
-- capi_providers.credentials already carries a single conversion_action_id
-- per Google connection (used today by the live CAPI pipeline, see
-- googleDelivery.ts) — reused here as the conversionAction resource for the
-- adjustment call, matched by orderId (original_transaction_id), same as
-- the existing best-effort CSV's "Order ID" column.

ALTER TABLE refund_events
  ADD COLUMN IF NOT EXISTS google_adjustment_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (google_adjustment_status IN ('pending', 'submitted', 'failed', 'skipped')),
  ADD COLUMN IF NOT EXISTS google_adjustment_error TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS google_adjustment_submitted_at TIMESTAMPTZ DEFAULT NULL;
