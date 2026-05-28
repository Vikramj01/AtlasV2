-- Fix profiles.organization_id never being set
--
-- Two root causes:
-- 1. handle_new_user() trigger creates the org but never writes
--    profiles.organization_id, so it is always NULL for users who
--    signed up after the multi-org migration (20260618).
-- 2. orgQueries.ts#createOrganisation wrote to `organisation_id`
--    (British) instead of `organization_id` (American), so the app-level
--    update also silently no-oped on the wrong column name.
--
-- This migration:
--   a) Ensures the column exists (nullable, no FK so preview-safe)
--   b) Backfills all rows where organization_id IS NULL from
--      organisation_members (owner role wins; admin role as fallback)
--   c) Replaces handle_new_user() to set the column on every new signup

-- ── a) Ensure column exists ───────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'profiles'
      AND column_name  = 'organization_id'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN organization_id UUID;
  END IF;
END $$;

-- ── b) Backfill from organisation_members ─────────────────────────────────────
UPDATE public.profiles p
SET    organization_id = om.organisation_id
FROM   public.organisation_members om
WHERE  om.user_id = p.id
  AND  om.role    = 'owner'
  AND  p.organization_id IS NULL;

-- Fallback: admin role for users without an owner row
UPDATE public.profiles p
SET    organization_id = om.organisation_id
FROM   public.organisation_members om
WHERE  om.user_id = p.id
  AND  om.role    = 'admin'
  AND  p.organization_id IS NULL;

-- ── c) Update signup trigger ──────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'organisations')
  AND EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'profiles') THEN
    EXECUTE $func$
      CREATE OR REPLACE FUNCTION public.handle_new_user()
      RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $inner$
      DECLARE
        v_org_id   UUID;
        v_basename TEXT;
        v_slug     TEXT;
      BEGIN
        INSERT INTO public.profiles (id, plan)
        VALUES (NEW.id, 'free')
        ON CONFLICT (id) DO NOTHING;

        v_basename := COALESCE(
          NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
          split_part(NEW.email, '@', 1)
        );

        v_slug := lower(regexp_replace(split_part(NEW.email, '@', 1), '[^a-z0-9]', '-', 'g'))
          || '-' || substring(replace(NEW.id::text, '-', ''), 1, 8);

        INSERT INTO public.organisations (name, slug, owner_id, plan)
        VALUES (v_basename || '''s Workspace', v_slug, NEW.id, 'free')
        RETURNING id INTO v_org_id;

        INSERT INTO public.organisation_members (organisation_id, user_id, role, accepted_at)
        VALUES (v_org_id, NEW.id, 'owner', now());

        UPDATE public.profiles
        SET    organization_id = v_org_id
        WHERE  id = NEW.id;

        RETURN NEW;
      END;
      $inner$
    $func$;
  END IF;
END $$;
