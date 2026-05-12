-- Sprint 4: persist signal timing metadata alongside journey stages.
-- Each key is an action key (e.g. "purchase") or "__proxy__" for the
-- stage-level proxy marker. Values are ConversionEventTiming objects.
ALTER TABLE journey_stages
  ADD COLUMN IF NOT EXISTS conversion_event_metadata JSONB NOT NULL DEFAULT '{}';
