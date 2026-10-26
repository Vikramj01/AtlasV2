-- GA4 Admin / L11 / Junk Gate follow-up to C3: the honeypot CSS selector the generated Signal Tag
-- reads (a boolean "was it filled" only — never the value).
--
-- Distinct from client_identity_configs.honeypot_field (20260923001), which is a DATA PATH resolved
-- against the raw event on the server. A path and a CSS selector are different syntaxes, so they are
-- two columns. NULL = not mapped. The generator and the config API both allow-list the value
-- (honeypotSelector.ts); this CHECK is a last line of defence, not the validator.

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'client_identity_configs') THEN
    ALTER TABLE client_identity_configs
      ADD COLUMN IF NOT EXISTS honeypot_selector TEXT NULL
      CHECK (honeypot_selector IS NULL OR char_length(honeypot_selector) BETWEEN 1 AND 100);
  END IF;
END $$;
