-- Public Audit Runs
-- Stores no-login instant audit results. Token is the sole access control.
-- Rows expire after 24 hours; a pg_cron job handles cleanup.

CREATE TABLE IF NOT EXISTS public_audit_runs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  token       TEXT        UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  url         TEXT        NOT NULL,
  ip_hash     TEXT        NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'scanning', 'done', 'failed')),
  score       INTEGER     CHECK (score BETWEEN 0 AND 100),
  grade       TEXT        CHECK (grade IN ('A', 'B', 'C', 'D')),
  findings    JSONB,
  ai_summary  TEXT,
  site_meta   JSONB,
  error       TEXT,
  email       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '24 hours'
);

CREATE INDEX IF NOT EXISTS public_audit_runs_token_idx     ON public_audit_runs (token);
CREATE INDEX IF NOT EXISTS public_audit_runs_ip_hash_idx   ON public_audit_runs (ip_hash, created_at);
CREATE INDEX IF NOT EXISTS public_audit_runs_expires_at_idx ON public_audit_runs (expires_at);

-- TTL cleanup: delete expired rows daily at 03:30 UTC
-- (requires pg_cron extension, already enabled on Supabase projects)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'public-audit-runs-ttl-cleanup',
      '30 3 * * *',
      $$DELETE FROM public_audit_runs WHERE expires_at < now()$$
    );
  END IF;
END;
$$;
