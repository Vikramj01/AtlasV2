-- Refund/return feedback to platforms
--
-- Records a refund against a prior purchase and tracks two delivery legs:
--   - Google: remove the customer from Customer Match/remarketing audiences via
--     DMA's audienceMembers.remove (real, reuses ingestCustomerMatchBatch from
--     customerMatch.ts) — this does NOT correct Google Ads' own conversion
--     value/count reporting, since DMA's events:ingest has no adjustment/
--     retraction capability (confirmed against DMA's own Discovery Document —
--     there is no such field or method anywhere in the API).
--   - Google adjustment CSV: generated in Google Ads' own "Uploads ->
--     Conversion Adjustments" format so the client can upload it themselves to
--     correct reporting/value — Atlas has no visibility into whether they
--     actually did, so this only tracks generation, not delivery.
--   - Meta: logged only — no reversal API exists.
--
-- RLS pattern: organization_id = auth.uid() (user isolation), matching the
-- convention from 20260317_001_consent_and_capi_tables.sql and
-- 20260406_001_offline_conversion_tables.sql.

CREATE TABLE IF NOT EXISTS refund_events (
  id                            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id               UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id                     UUID        REFERENCES clients(id) ON DELETE SET NULL,

  original_transaction_id       TEXT        NOT NULL,
  refund_amount                 DECIMAL(12,2) NOT NULL,
  currency                      TEXT        NOT NULL CHECK (char_length(currency) = 3),
  is_partial                    BOOLEAN     NOT NULL DEFAULT false,
  -- Required for partial refunds: the corrected order total AFTER the refund
  -- (an absolute value, not a delta) — Google's RESTATEMENT adjustment needs
  -- the new total, and Atlas doesn't otherwise know the original order value
  -- to compute it.
  new_conversion_value           DECIMAL(12,2) DEFAULT NULL,
  reason                        TEXT        DEFAULT NULL,

  -- Identity for the Google audience-removal call. Hashed immediately on
  -- write — raw email/phone never persisted, matching customerMatch.ts and
  -- offline_conversion_rows.
  hashed_email                  TEXT        DEFAULT NULL,
  hashed_phone                  TEXT        DEFAULT NULL,

  google_removal_status         TEXT        NOT NULL DEFAULT 'pending'
                                             CHECK (google_removal_status IN ('pending', 'removed', 'failed', 'skipped')),
  google_removal_error          TEXT        DEFAULT NULL,

  adjustment_csv_generated_at   TIMESTAMPTZ DEFAULT NULL,

  meta_status                   TEXT        NOT NULL DEFAULT 'logged'
                                             CHECK (meta_status IN ('logged')),

  created_by                    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refund_events_org_created
  ON refund_events(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_refund_events_transaction
  ON refund_events(organization_id, original_transaction_id);

ALTER TABLE refund_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_isolation" ON refund_events;
CREATE POLICY "user_isolation" ON refund_events
  FOR ALL USING (organization_id = auth.uid());

-- Reuses the update_updated_at() function defined in
-- 20260317_001_consent_and_capi_tables.sql.
DROP TRIGGER IF EXISTS trg_refund_events_updated ON refund_events;
CREATE TRIGGER trg_refund_events_updated
  BEFORE UPDATE ON refund_events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
