-- rule_confirmations (Pre-Connection Scan Confidence Tiering PRD §15, Sprint
-- 7 of docs/atlas-sprint-plan-pre-connection-confidence-tiering.md).
--
-- The long-term answer to "why should we believe your scan" is measured
-- data, not method description. Every row here marks one prior finding
-- (audit_id + rule_id) CONFIRMED or REFUTED by an independent signal —
-- a client's answer to an open question, an operator's own verification,
-- or an automatic re-scan comparison (a rule that failed on the
-- immediately-previous scan for the same site and passes on this one,
-- which confirms the original absence claim correctly identified a real
-- gap that's now fixed). This yields a per-rule measured false-negative
-- rate over time — used internally to tighten a rule's gated direction or
-- fix its detector, and eventually (once the sample is meaningful — not
-- yet) to state a defensible, evidence-backed accuracy claim in the
-- report itself. No accuracy figure is computed or published by this
-- migration or the code that writes to this table; this is data capture
-- only.
--
-- `finding_id` is nullable and unused today: this schema has no per-
-- finding identity distinct from (audit_id, rule_id) — a rule produces
-- exactly one finding per audit — so there's nothing more granular to
-- store yet. Kept as a column (per the PRD's literal schema) for forward
-- compatibility if that ever changes, rather than invented as a
-- duplicate of rule_id.
--
-- RLS pattern: audit_id IN (SELECT id FROM audits WHERE user_id = auth.uid()),
-- matching audit_results/audit_reports/signal_conflicts — not the PRD's
-- literal `organization_id` column, which this codebase's audits aren't
-- scoped by at the row level (see signal_conflicts' migration for the
-- same documented deviation).

CREATE TABLE IF NOT EXISTS public.rule_confirmations (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id          UUID        NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  rule_id           TEXT        NOT NULL,
  finding_id        TEXT,
  outcome           TEXT        NOT NULL CHECK (outcome IN ('CONFIRMED', 'REFUTED', 'UNKNOWN')),
  source            TEXT        NOT NULL CHECK (source IN ('client_answer', 'rescan', 'operator')),
  note              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rule_confirmations_audit_id ON public.rule_confirmations (audit_id);
CREATE INDEX IF NOT EXISTS idx_rule_confirmations_rule_id ON public.rule_confirmations (rule_id);

ALTER TABLE public.rule_confirmations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rule_confirmations_owner" ON public.rule_confirmations;
CREATE POLICY "rule_confirmations_owner"
  ON public.rule_confirmations FOR ALL
  USING (
    audit_id IN (SELECT id FROM public.audits WHERE user_id = auth.uid())
  );
