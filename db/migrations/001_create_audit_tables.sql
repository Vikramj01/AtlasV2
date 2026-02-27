-- Atlas Signal Integrity Auditor
-- Migration 001: Core audit tables
-- Run this in Supabase SQL Editor (or via supabase db push)

-- ─── profiles table (extend Supabase auth.users) ─────────────────────────────
-- Required if not already created by your Supabase Auth setup

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'agency')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id)
  VALUES (NEW.id)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─── audits table ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  website_url TEXT NOT NULL,
  funnel_type TEXT NOT NULL CHECK (funnel_type IN ('ecommerce', 'saas', 'lead_gen')),
  region TEXT NOT NULL DEFAULT 'us' CHECK (region IN ('us', 'eu', 'global')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  browserbase_session_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_audits_user_id ON public.audits(user_id);
CREATE INDEX IF NOT EXISTS idx_audits_status ON public.audits(status);
CREATE INDEX IF NOT EXISTS idx_audits_created_at ON public.audits(created_at DESC);

-- ─── audit_results table ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.audit_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id UUID NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  validation_layer TEXT NOT NULL CHECK (validation_layer IN ('signal_initiation', 'parameter_completeness', 'persistence')),
  rule_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pass', 'fail', 'warning')),
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  technical_details JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_results_audit_id ON public.audit_results(audit_id);
CREATE INDEX IF NOT EXISTS idx_audit_results_rule_id ON public.audit_results(rule_id);

-- ─── audit_reports table ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.audit_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id UUID NOT NULL UNIQUE REFERENCES public.audits(id) ON DELETE CASCADE,
  report_json JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ─── Row Level Security ───────────────────────────────────────────────────────

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_reports ENABLE ROW LEVEL SECURITY;

-- profiles: users can only read/update their own profile
CREATE POLICY "Users can read own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- audits: users can only read their own audits
CREATE POLICY "Users can read own audits"
  ON public.audits FOR SELECT
  USING (auth.uid() = user_id);

-- audit_results: accessible via audit ownership
CREATE POLICY "Users can read own audit results"
  ON public.audit_results FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.audits
      WHERE audits.id = audit_results.audit_id
        AND audits.user_id = auth.uid()
    )
  );

-- audit_reports: accessible via audit ownership
CREATE POLICY "Users can read own audit reports"
  ON public.audit_reports FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.audits
      WHERE audits.id = audit_reports.audit_id
        AND audits.user_id = auth.uid()
    )
  );

-- Note: INSERT/UPDATE/DELETE on audits, audit_results, audit_reports is done by the
-- backend service role key, which bypasses RLS. Do NOT add write policies for users.
