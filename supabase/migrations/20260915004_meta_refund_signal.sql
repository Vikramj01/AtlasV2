-- Meta refund/cancellation CAPI signal event.
--
-- Not a reversal (Meta's Offline Conversions API was fully discontinued May
-- 2025, and the unified Conversions API has no adjustment/retraction verb) —
-- this is a new, forward-looking custom event (atlas_refund /
-- atlas_order_cancellation) carrying the same hashed identifiers as the
-- original purchase, so Meta's dataset reflects the cancellation for
-- audience-exclusion purposes even though the original Purchase conversion
-- itself can't be un-counted.
--
-- Widens refund_events.meta_status past its current binary 'logged' value
-- so the new automated signal's outcome is distinct from "never attempted".
-- 'logged' is kept (not renamed) for existing rows recorded before this
-- migration — they never had a signal attempted.

ALTER TABLE refund_events DROP CONSTRAINT IF EXISTS refund_events_meta_status_check;
ALTER TABLE refund_events ADD CONSTRAINT refund_events_meta_status_check
  CHECK (meta_status IN ('logged', 'signal_sent', 'failed', 'skipped'));

ALTER TABLE refund_events ADD COLUMN IF NOT EXISTS meta_status_error TEXT DEFAULT NULL;
