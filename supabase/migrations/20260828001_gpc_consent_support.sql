-- GPC (Global Privacy Control) support (B1, ATLAS_CONVERSION_SIGNAL_LAYER_SPRINT_PLAN.md)
--
-- Twelve US states have required programmatic GPC honouring since 1 Jan 2026.
-- This adds:
--   1. A 'gpc' value to consent_records.source, so a GPC-triggered denial is
--      distinguishable from a banner click or CMP-driven decision (the audit
--      trail enforcement sweeps check for) — the M4 acceptance criterion.
--   2. consent_configs.gpc_hard_block: per-org control over whether the
--      consent banner re-prompts after a GPC denial (default true — GPC
--      honouring itself is not optional either way, this only controls the
--      re-prompt behaviour). Follows this repo's naming convention of
--      YYYYMMDDNNN_name.sql (no underscore between date and sequence — see
--      the migration filename collision fix in the same PR history).

alter table consent_records drop constraint if exists consent_records_source_check;
alter table consent_records
  add constraint consent_records_source_check
  check (source in ('builtin', 'onetrust', 'cookiebot', 'usercentrics', 'api', 'gpc'));

alter table consent_configs
  add column if not exists gpc_hard_block boolean not null default true;
