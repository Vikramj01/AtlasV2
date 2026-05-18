-- ── Organisation members table + schema alignment ─────────────────────────────
--
-- Root cause: organisation_members table was missing, breaking:
--   • orgMiddleware (403 on all /api/organisations/:orgId/* routes)
--   • listOrganisations (empty result → no org in sidebar)
--   • org/client creation
--
-- Also adds missing columns to organisations (owner_id, slug, plan)
-- and plan to profiles so authMiddleware can read it correctly.
-- Updates handle_new_user trigger to auto-create an org + membership on signup.

-- ── 1. Add missing columns to organisations ────────────────────────────────────
ALTER TABLE public.organisations
  ADD COLUMN IF NOT EXISTS owner_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS slug       TEXT,
  ADD COLUMN IF NOT EXISTS plan       TEXT NOT NULL DEFAULT 'free';

CREATE UNIQUE INDEX IF NOT EXISTS organisations_slug_key
  ON public.organisations (slug)
  WHERE slug IS NOT NULL;

-- ── 2. Add plan column to profiles ────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';

-- ── 3. Create organisation_members table ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.organisation_members (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID        NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role            TEXT        NOT NULL DEFAULT 'member'
                              CHECK (role IN ('owner', 'admin', 'member')),
  invited_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at     TIMESTAMPTZ,
  UNIQUE (organisation_id, user_id)
);

ALTER TABLE public.organisation_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_select" ON public.organisation_members
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "org_members_insert" ON public.organisation_members
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "org_members_update" ON public.organisation_members
  FOR UPDATE USING (auth.uid() IS NOT NULL);

CREATE POLICY "org_members_delete" ON public.organisation_members
  FOR DELETE USING (auth.uid() IS NOT NULL);

-- ── 4. Seed memberships for existing profiles ──────────────────────────────────
INSERT INTO public.organisation_members (organisation_id, user_id, role, accepted_at)
SELECT p.org_id, p.id, 'owner', now()
FROM   public.profiles p
WHERE  p.org_id IS NOT NULL
  AND  EXISTS (SELECT 1 FROM public.organisations o WHERE o.id = p.org_id)
ON CONFLICT (organisation_id, user_id) DO NOTHING;

-- ── 5. Auto-create org + membership on signup ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id   UUID;
  v_basename TEXT;
  v_slug     TEXT;
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url'
  );

  v_basename := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
    split_part(NEW.email, '@', 1)
  );

  v_slug := lower(regexp_replace(split_part(NEW.email, '@', 1), '[^a-z0-9]', '-', 'g'))
    || '-' || substring(replace(NEW.id::text, '-', ''), 1, 8);

  INSERT INTO public.organisations (name, slug, owner_id, plan, org_type)
  VALUES (
    v_basename || '''s Workspace',
    v_slug,
    NEW.id,
    'free',
    'agency'
  )
  RETURNING id INTO v_org_id;

  UPDATE public.profiles
  SET    org_id = v_org_id,
         plan   = 'free'
  WHERE  id = NEW.id;

  INSERT INTO public.organisation_members (organisation_id, user_id, role, accepted_at)
  VALUES (v_org_id, NEW.id, 'owner', now());

  RETURN NEW;
END;
$$;
