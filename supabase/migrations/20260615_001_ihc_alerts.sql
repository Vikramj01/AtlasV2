-- Phase E: IHC alert tracking
-- Adds last_alerted_at to audit_findings for dedup, and ihc_alert_log for
-- per-finding per-type send history (critical batching + digest dedup).

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'audit_findings') THEN
    ALTER TABLE public.audit_findings
      ADD COLUMN IF NOT EXISTS last_alerted_at timestamptz;
  END IF;
END $$;

-- ihc_alert_log — records every alert email sent per finding per type.
-- Used to enforce dedup (alert once per open transition), anti-flap (24h
-- suppress on rapid reopen), and critical batching (15-min rolling window).

CREATE TABLE IF NOT EXISTS public.ihc_alert_log (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL,
  finding_id        uuid        NOT NULL,
  alert_type        text        NOT NULL, -- 'critical_immediate' | 'daily_digest' | 'weekly_digest'
  sent_at           timestamptz NOT NULL DEFAULT now(),
  batch_id          text,                -- groups findings sent in the same email
  created_at        timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'audit_findings') THEN
    ALTER TABLE public.ihc_alert_log
      ADD CONSTRAINT IF NOT EXISTS ihc_alert_log_finding_fk
        FOREIGN KEY (finding_id) REFERENCES public.audit_findings(id) ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_ihc_alert_log_org     ON public.ihc_alert_log(organization_id);
CREATE INDEX IF NOT EXISTS idx_ihc_alert_log_finding ON public.ihc_alert_log(finding_id, alert_type, sent_at DESC);

ALTER TABLE public.ihc_alert_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org members can read own alert log" ON public.ihc_alert_log;
CREATE POLICY "org members can read own alert log"
  ON public.ihc_alert_log FOR SELECT
  USING (
    organization_id = (
      SELECT organization_id FROM public.profiles WHERE id = auth.uid()
    )
  );
