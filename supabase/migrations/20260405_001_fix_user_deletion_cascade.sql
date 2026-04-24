-- ============================================================
-- Fix user deletion: cascade + pre-delete cleanup trigger
--
-- Problem: Supabase dashboard (and auth.admin.deleteUser()) fails with a
-- database error because public-schema tables hold user_id FKs to
-- auth.users without ON DELETE CASCADE.
--
-- Solution (two-layer):
--   1. Re-create the profiles FK with ON DELETE CASCADE.
--   2. BEFORE DELETE trigger on auth.users that explicitly deletes rows
--      from every user-scoped table. Each DELETE runs in its own
--      exception block so a missing table never aborts the trigger.
-- ============================================================


-- ── 1. Fix profiles FK ────────────────────────────────────────────────────────
-- Guarded: profiles is not created by a migration; skip if it doesn't exist yet.

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'profiles') THEN
    EXECUTE 'ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey';
    EXECUTE $q$
      ALTER TABLE public.profiles
        ADD CONSTRAINT profiles_id_fkey
          FOREIGN KEY (id)
          REFERENCES auth.users(id)
          ON DELETE CASCADE
    $q$;
  END IF;
END $$;


-- ── 2. Cleanup function ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_user_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Each block is isolated: if the table doesn't exist or the delete fails,
  -- it is silently skipped and the trigger continues.

  BEGIN DELETE FROM public.profiles WHERE id = OLD.id; EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM public.audit_results WHERE user_id = OLD.id; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM public.audit_reports WHERE user_id = OLD.id; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM public.audits WHERE user_id = OLD.id; EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN
    DELETE FROM public.planning_recommendations WHERE session_id IN (
      SELECT id FROM public.planning_sessions WHERE user_id = OLD.id
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN
    DELETE FROM public.planning_pages WHERE session_id IN (
      SELECT id FROM public.planning_sessions WHERE user_id = OLD.id
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN
    DELETE FROM public.planning_outputs WHERE session_id IN (
      SELECT id FROM public.planning_sessions WHERE user_id = OLD.id
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM public.planning_sessions WHERE user_id = OLD.id; EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN
    DELETE FROM public.implementation_progress WHERE share_id IN (
      SELECT id FROM public.developer_shares WHERE user_id = OLD.id
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM public.developer_shares WHERE user_id = OLD.id; EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN
    DELETE FROM public.journey_platforms WHERE journey_id IN (
      SELECT id FROM public.journeys WHERE user_id = OLD.id
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN
    DELETE FROM public.journey_stages WHERE journey_id IN (
      SELECT id FROM public.journeys WHERE user_id = OLD.id
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM public.journeys WHERE user_id = OLD.id; EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN
    DELETE FROM public.signal_pack_signals WHERE pack_id IN (
      SELECT id FROM public.signal_packs WHERE user_id = OLD.id
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM public.signal_packs WHERE user_id = OLD.id; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM public.signals WHERE user_id = OLD.id; EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM public.health_alerts WHERE user_id = OLD.id; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM public.health_snapshots WHERE user_id = OLD.id; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM public.health_scores WHERE user_id = OLD.id; EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM public.capi_event_queue WHERE organization_id = OLD.id; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM public.capi_events WHERE organization_id = OLD.id; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM public.capi_providers WHERE organization_id = OLD.id; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM public.consent_records WHERE organization_id = OLD.id; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM public.consent_configs WHERE organization_id = OLD.id; EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM public.channel_diagnostics WHERE user_id = OLD.id; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM public.channel_journey_maps WHERE user_id = OLD.id; EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN
    DELETE FROM public.channel_session_events WHERE session_id IN (
      SELECT id FROM public.channel_sessions WHERE user_id = OLD.id
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM public.channel_sessions WHERE user_id = OLD.id; EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM public.scheduled_audits WHERE user_id = OLD.id; EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM public.organisation_members WHERE user_id = OLD.id; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM public.organisations WHERE owner_id = OLD.id; EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM public.generated_specs WHERE user_id = OLD.id; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM public.deployments WHERE user_id = OLD.id; EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN
    DELETE FROM public.client_platforms WHERE client_id IN (
      SELECT id FROM public.clients WHERE user_id = OLD.id
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN
    DELETE FROM public.client_pages WHERE client_id IN (
      SELECT id FROM public.clients WHERE user_id = OLD.id
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN
    DELETE FROM public.client_outputs WHERE client_id IN (
      SELECT id FROM public.clients WHERE user_id = OLD.id
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM public.clients WHERE user_id = OLD.id; EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN OLD;
END;
$$;


-- ── 3. Attach trigger to auth.users ──────────────────────────────────────────

DROP TRIGGER IF EXISTS on_auth_user_deleted ON auth.users;

CREATE TRIGGER on_auth_user_deleted
  BEFORE DELETE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_user_deletion();
