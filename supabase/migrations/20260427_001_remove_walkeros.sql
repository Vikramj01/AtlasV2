-- Sprint 2.1: Remove WalkerOS from database constraints
-- All operations are guarded: safe to run on databases where these
-- tables may not exist yet.

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'journeys') THEN
    UPDATE public.journeys
      SET implementation_format = 'gtm'
      WHERE implementation_format IN ('walkeros', 'both');

    EXECUTE 'ALTER TABLE public.journeys DROP CONSTRAINT IF EXISTS journeys_implementation_format_check';
    EXECUTE 'ALTER TABLE public.journeys ADD CONSTRAINT journeys_implementation_format_check CHECK (implementation_format IN (''gtm''))';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'planning_outputs') THEN
    UPDATE public.planning_outputs
      SET output_type = 'implementation_guide'
      WHERE output_type = 'walkeros_flow';

    EXECUTE 'ALTER TABLE public.planning_outputs DROP CONSTRAINT IF EXISTS planning_outputs_output_type_check';
    EXECUTE $q$ALTER TABLE public.planning_outputs ADD CONSTRAINT planning_outputs_output_type_check CHECK (output_type IN ('gtm_container', 'datalayer_spec', 'implementation_guide'))$q$;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'client_outputs') THEN
    UPDATE public.client_outputs
      SET output_type = 'datalayer_spec'
      WHERE output_type = 'walkeros_flow';

    EXECUTE 'ALTER TABLE public.client_outputs DROP CONSTRAINT IF EXISTS client_outputs_output_type_check';
    EXECUTE $q$ALTER TABLE public.client_outputs ADD CONSTRAINT client_outputs_output_type_check CHECK (output_type IN ('gtm_container', 'datalayer_spec', 'implementation_guide'))$q$;
  END IF;
END $$;
