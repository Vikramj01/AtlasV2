-- Measurement governance tier per strategy objective
-- conversion_tier: how the platform should treat this event
-- platform_action_types: per-platform mapping (e.g. {google_ads: "primary_action", meta: "custom_event"})

ALTER TABLE strategy_objectives
  ADD COLUMN IF NOT EXISTS conversion_tier      text CHECK (conversion_tier IN ('primary', 'secondary', 'suppression')),
  ADD COLUMN IF NOT EXISTS platform_action_types jsonb;
