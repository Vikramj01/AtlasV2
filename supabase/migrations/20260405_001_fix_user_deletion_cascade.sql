-- ============================================================
-- Fix user deletion: cascade + pre-delete cleanup trigger
--
-- Problem: Supabase dashboard (and auth.admin.deleteUser()) fails with a
-- database error when deleting a user because multiple public-schema tables
-- hold user_id / id FKs to auth.users without ON DELETE CASCADE.
--
-- Solution (two-layer):
--   1. Re-create the profiles FK with ON DELETE CASCADE so the most
--      common Supabase pattern works correctly.
--   2. Create a BEFORE DELETE trigger on auth.users that explicitly
--      removes rows from every user-scoped table. This covers any table
--      whose FK was created without CASCADE (existing or future).
--      Running cleanup in BEFORE DELETE means the rows are gone before
--      Postgres enforces the FK constraints on auth.users.
-- ============================================================


-- ── 1. Fix profiles FK ────────────────────────────────────────────────────────
-- The profiles table uses id (PK) as the FK to auth.users(id).
-- Drop any existing constraint and re-add with CASCADE.

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_id_fkey;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_id_fkey
    FOREIGN KEY (id)
    REFERENCES auth.users(id)
    ON DELETE CASCADE;


-- ── 2. Cleanup function ───────────────────────────────────────────────────────
-- Called by the trigger below. Deletes every user-scoped row across all
-- public-schema tables before auth.users removes the record.
-- SECURITY DEFINER runs with the privileges of the function owner (postgres)
-- so it can bypass RLS on all tables.

CREATE OR REPLACE FUNCTION public.handle_user_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- ── Core auth / profile data ───────────────────────────────────────────────
  DELETE FROM public.profiles                WHERE id          = OLD.id;

  -- ── Audit data ────────────────────────────────────────────────────────────
  DELETE FROM public.audit_results           WHERE user_id     = OLD.id;
  DELETE FROM public.audit_reports           WHERE user_id     = OLD.id;
  DELETE FROM public.audits                  WHERE user_id     = OLD.id;

  -- ── Planning data ─────────────────────────────────────────────────────────
  -- planning_pages and planning_recommendations cascade from planning_sessions
  -- (they reference session_id with ON DELETE CASCADE), so deleting sessions
  -- is sufficient. But we delete explicitly to be safe.
  DELETE FROM public.planning_recommendations WHERE session_id IN (
    SELECT id FROM public.planning_sessions WHERE user_id = OLD.id
  );
  DELETE FROM public.planning_pages          WHERE session_id IN (
    SELECT id FROM public.planning_sessions WHERE user_id = OLD.id
  );
  DELETE FROM public.planning_outputs        WHERE session_id IN (
    SELECT id FROM public.planning_sessions WHERE user_id = OLD.id
  );
  DELETE FROM public.planning_sessions       WHERE user_id     = OLD.id;

  -- ── Developer portal ──────────────────────────────────────────────────────
  DELETE FROM public.implementation_progress WHERE share_id IN (
    SELECT id FROM public.developer_shares WHERE user_id = OLD.id
  );
  DELETE FROM public.developer_shares        WHERE user_id     = OLD.id;

  -- ── Journey builder ───────────────────────────────────────────────────────
  DELETE FROM public.journey_platforms       WHERE journey_id IN (
    SELECT id FROM public.journeys WHERE user_id = OLD.id
  );
  DELETE FROM public.journey_stages          WHERE journey_id IN (
    SELECT id FROM public.journeys WHERE user_id = OLD.id
  );
  DELETE FROM public.journeys                WHERE user_id     = OLD.id;

  -- ── Signal library ────────────────────────────────────────────────────────
  DELETE FROM public.signal_pack_signals     WHERE pack_id IN (
    SELECT id FROM public.signal_packs WHERE user_id = OLD.id
  );
  DELETE FROM public.signal_packs            WHERE user_id     = OLD.id;
  DELETE FROM public.signals                 WHERE user_id     = OLD.id;

  -- ── Health data ───────────────────────────────────────────────────────────
  DELETE FROM public.health_alerts           WHERE user_id     = OLD.id;
  DELETE FROM public.health_snapshots        WHERE user_id     = OLD.id;
  DELETE FROM public.health_scores           WHERE user_id     = OLD.id;

  -- ── Consent + CAPI ────────────────────────────────────────────────────────
  -- These tables use organization_id = auth.users.id (ON DELETE CASCADE already
  -- set in the original migration), but we delete explicitly to be safe.
  DELETE FROM public.capi_event_queue        WHERE organization_id = OLD.id;
  DELETE FROM public.capi_events             WHERE organization_id = OLD.id;
  DELETE FROM public.capi_providers          WHERE organization_id = OLD.id;
  DELETE FROM public.consent_records         WHERE organization_id = OLD.id;
  DELETE FROM public.consent_configs         WHERE organization_id = OLD.id;

  -- ── Channel data ──────────────────────────────────────────────────────────
  DELETE FROM public.channel_diagnostics     WHERE user_id     = OLD.id;
  DELETE FROM public.channel_journey_maps    WHERE user_id     = OLD.id;
  DELETE FROM public.channel_session_events  WHERE session_id IN (
    SELECT id FROM public.channel_sessions WHERE user_id = OLD.id
  );
  DELETE FROM public.channel_sessions        WHERE user_id     = OLD.id;

  -- ── Scheduled jobs ────────────────────────────────────────────────────────
  DELETE FROM public.scheduled_audits        WHERE user_id     = OLD.id;

  -- ── Organisation memberships ──────────────────────────────────────────────
  -- Remove the user from any orgs they're a member of.
  -- Owned orgs: cascade-delete the org (which removes all members).
  DELETE FROM public.organisation_members    WHERE user_id     = OLD.id;
  DELETE FROM public.organisations           WHERE owner_id    = OLD.id;

  -- ── Client workspaces ─────────────────────────────────────────────────────
  DELETE FROM public.generated_specs         WHERE user_id     = OLD.id;
  DELETE FROM public.deployments             WHERE user_id     = OLD.id;
  DELETE FROM public.client_platforms        WHERE client_id IN (
    SELECT id FROM public.clients WHERE user_id = OLD.id
  );
  DELETE FROM public.client_pages            WHERE client_id IN (
    SELECT id FROM public.clients WHERE user_id = OLD.id
  );
  DELETE FROM public.client_outputs          WHERE client_id IN (
    SELECT id FROM public.clients WHERE user_id = OLD.id
  );
  DELETE FROM public.clients                 WHERE user_id     = OLD.id;

  RETURN OLD;
END;
$$;


-- ── 3. Attach trigger to auth.users ──────────────────────────────────────────
-- BEFORE DELETE ensures cleanup happens before Postgres checks FK constraints.

DROP TRIGGER IF EXISTS on_auth_user_deleted ON auth.users;

CREATE TRIGGER on_auth_user_deleted
  BEFORE DELETE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_user_deletion();
