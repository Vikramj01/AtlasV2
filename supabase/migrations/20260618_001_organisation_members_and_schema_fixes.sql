-- ── Organisation members table + signup trigger fix ────────────────────────────
--
-- organisations already has: id, name, slug, owner_id, plan, created_at, updated_at
-- profiles already has: id, plan (no org reference column)
--
-- What was missing:
--   • organisation_members table → orgMiddleware returned 403 on all client routes
--                                  and listOrganisations returned empty
--   • handle_new_user trigger did not create an org or membership on signup
--
-- Preview-safety: FKs to organisations/auth.users are applied conditionally
-- per the project convention (preview envs may not have those tables).

-- ── 1. Create organisation_members (soft FKs for preview safety) ───────────────
CREATE TABLE IF NOT EXISTS public.organisation_members (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID        NOT NULL,
  user_id         UUID        NOT NULL,
  role            TEXT        NOT NULL DEFAULT 'member'
                              CHECK (role IN ('owner', 'admin', 'member')),
  invited_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at     TIMESTAMPTZ,
  UNIQUE (organisation_id, user_id)
);

-- Add FK to organisations only if that table exists
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'organisations')
  AND NOT EXISTS (
    SELECT FROM information_schema.table_constraints
    WHERE constraint_name = 'organisation_members_organisation_id_fkey'
      AND table_name = 'organisation_members'
      AND table_schema = 'public'
  ) THEN
    EXECUTE '
      ALTER TABLE public.organisation_members
        ADD CONSTRAINT organisation_members_organisation_id_fkey
        FOREIGN KEY (organisation_id) REFERENCES public.organisations(id) ON DELETE CASCADE
    ';
  END IF;
END $$;

-- Add FK to auth.users only if that schema/table exists
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'users')
  AND NOT EXISTS (
    SELECT FROM information_schema.table_constraints
    WHERE constraint_name = 'organisation_members_user_id_fkey'
      AND table_name = 'organisation_members'
      AND table_schema = 'public'
  ) THEN
    EXECUTE '
      ALTER TABLE public.organisation_members
        ADD CONSTRAINT organisation_members_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
    ';
  END IF;
END $$;

ALTER TABLE public.organisation_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_select" ON public.organisation_members
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "org_members_insert" ON public.organisation_members
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "org_members_update" ON public.organisation_members
  FOR UPDATE USING (auth.uid() IS NOT NULL);

CREATE POLICY "org_members_delete" ON public.organisation_members
  FOR DELETE USING (auth.uid() IS NOT NULL);

-- ── 2. Update signup trigger (guarded: only if both tables exist) ──────────────
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

        RETURN NEW;
      END;
      $inner$
    $func$;
  END IF;
END $$;
