-- ── Organisation members table + signup trigger fix ────────────────────────────
--
-- organisations already has: id, name, slug, owner_id, plan, created_at, updated_at
-- profiles already has: id, plan (no org reference column)
--
-- What was missing:
--   • organisation_members table → orgMiddleware returned 403 on all client routes
--                                  and listOrganisations returned empty
--   • handle_new_user trigger did not create an org or membership on signup

-- ── 1. Create organisation_members ────────────────────────────────────────────
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

-- ── 2. Update signup trigger ───────────────────────────────────────────────────
-- Auto-creates an organisation and owner membership for every new user.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;
