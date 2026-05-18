-- Journey tables (journeys, journey_stages, journey_platforms, generated_specs)
-- journey_stages includes proxy_value_gbp and buyer_intent_level from the B2B sprint.

CREATE TABLE IF NOT EXISTS journeys (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name                      TEXT        NOT NULL DEFAULT 'Untitled Journey',
  business_type             TEXT        NOT NULL,
  status                    TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  implementation_format     TEXT        NOT NULL DEFAULT 'gtm',
  source_planning_session_id UUID,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE journeys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS journeys_owner ON journeys;
CREATE POLICY journeys_owner ON journeys USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS journey_stages (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id                UUID        NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  stage_order               INTEGER     NOT NULL,
  label                     TEXT        NOT NULL,
  page_type                 TEXT        NOT NULL,
  sample_url                TEXT,
  actions                   TEXT[]      NOT NULL DEFAULT '{}',
  conversion_event_metadata JSONB       NOT NULL DEFAULT '{}',
  proxy_value_gbp           NUMERIC     CHECK (proxy_value_gbp >= 0),
  buyer_intent_level        TEXT        CHECK (buyer_intent_level IN ('problem_aware','solution_aware','vendor_aware')),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (journey_id, stage_order)
);

ALTER TABLE journey_stages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS journey_stages_owner ON journey_stages;
CREATE POLICY journey_stages_owner ON journey_stages
  USING (journey_id IN (SELECT id FROM journeys WHERE user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS journey_platforms (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id     UUID        NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  platform       TEXT        NOT NULL,
  is_active      BOOLEAN     NOT NULL DEFAULT TRUE,
  measurement_id TEXT,
  config         JSONB       NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (journey_id, platform)
);

ALTER TABLE journey_platforms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS journey_platforms_owner ON journey_platforms;
CREATE POLICY journey_platforms_owner ON journey_platforms
  USING (journey_id IN (SELECT id FROM journeys WHERE user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS generated_specs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id   UUID        NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  format       TEXT        NOT NULL,
  spec_data    JSONB       NOT NULL DEFAULT '{}',
  version      INTEGER     NOT NULL DEFAULT 1,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE generated_specs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS generated_specs_owner ON generated_specs;
CREATE POLICY generated_specs_owner ON generated_specs
  USING (journey_id IN (SELECT id FROM journeys WHERE user_id = auth.uid()));
