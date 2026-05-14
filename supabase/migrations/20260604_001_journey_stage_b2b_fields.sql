-- B2B Journey Stage fields: proxy monetary value + buyer intent level
-- Used by the B2B Lead Gen template and value-based bidding setup

ALTER TABLE journey_stages
  ADD COLUMN IF NOT EXISTS proxy_value_gbp  numeric          CHECK (proxy_value_gbp >= 0),
  ADD COLUMN IF NOT EXISTS buyer_intent_level text            CHECK (buyer_intent_level IN ('problem_aware', 'solution_aware', 'vendor_aware'));
