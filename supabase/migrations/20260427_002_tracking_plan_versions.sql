-- Sprint 2.5: tracking_plan_versions — version history for planning outputs
-- Guarded: skipped entirely if planning_sessions doesn't exist yet.

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'planning_sessions') THEN
    IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'tracking_plan_versions') THEN
      EXECUTE $q$
        CREATE TABLE tracking_plan_versions (
          id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          session_id      UUID NOT NULL REFERENCES planning_sessions(id) ON DELETE CASCADE,
          version         INTEGER NOT NULL,
          label           TEXT,
          gtm_output_id   UUID REFERENCES planning_outputs(id) ON DELETE SET NULL,
          spec_output_id  UUID REFERENCES planning_outputs(id) ON DELETE SET NULL,
          guide_output_id UUID REFERENCES planning_outputs(id) ON DELETE SET NULL,
          created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (session_id, version)
        )
      $q$;

      EXECUTE 'CREATE INDEX tracking_plan_versions_session_id_idx ON tracking_plan_versions (session_id, version DESC)';
      EXECUTE 'ALTER TABLE tracking_plan_versions ENABLE ROW LEVEL SECURITY';
      EXECUTE $q$
        CREATE POLICY "Users access own session versions"
          ON tracking_plan_versions FOR ALL
          USING (session_id IN (SELECT id FROM planning_sessions WHERE user_id = auth.uid()))
      $q$;
    END IF;
  END IF;
END $$;
