-- Sprint LinkedIn CAPI — Ticket 8: Fix capi_providers status CHECK constraint
--
-- The original constraint (20260317_001_consent_and_capi_tables.sql) only covers:
--   draft | testing | active | paused | error
--
-- The backend route POST /api/capi/providers/:id/reconnect sets status to
-- 'reconnect_required', which violates the existing constraint. This migration
-- drops the old constraint by inspecting pg_constraint (so it is safe regardless
-- of the auto-generated name) and re-adds it with the full set of values.
--
-- Guard: the entire block is a no-op if capi_providers does not exist in the
-- target environment (Supabase preview branches that branched before 20260317).

DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'capi_providers'
  ) THEN
    RETURN;
  END IF;

  -- Locate the existing status CHECK constraint by its definition text.
  -- Using pg_get_constraintdef avoids relying on the auto-generated name.
  SELECT conname INTO v_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.capi_providers'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%status%'
  LIMIT 1;

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE capi_providers DROP CONSTRAINT ' || quote_ident(v_constraint_name);
  END IF;

  ALTER TABLE capi_providers
    ADD CONSTRAINT capi_providers_status_check
    CHECK (status IN ('draft', 'testing', 'active', 'paused', 'error', 'reconnect_required'));
END;
$$;
