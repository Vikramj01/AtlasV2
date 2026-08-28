-- DQM Alert Preferences
--
-- B12 (ATLAS_CONVERSION_SIGNAL_LAYER_SPRINT_PLAN.md): DQM detection/scheduling
-- already exists (dqmOrchestrator.ts, the */15 * * * * Bull cron) and already
-- writes to health_alerts via createAlert() — this table is the missing piece
-- that lets that alert actually reach a human, mirroring the per-org
-- notification-channel pattern already established by ihc_alert_preferences
-- rather than inventing a new shape.
--
-- Unlike ihc_alert_preferences, DQM alerts are not digested — dqm_gtg/dqm_dma
-- alerts already only fire on state transitions (open/resolve) via
-- dqmAlertEvaluator.ts, so there's no volume problem to batch against. One row
-- per org; INSERT on first save, UPDATE thereafter.

create table if not exists dqm_alert_preferences (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null unique,
  email_enabled       boolean not null default true,
  slack_enabled       boolean not null default false,
  slack_webhook_url   text,
  recipient_user_ids  uuid[] not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'organizations') then
    if not exists (
      select 1 from information_schema.table_constraints
      where table_name = 'dqm_alert_preferences'
        and constraint_name = 'dqm_alert_preferences_organization_id_fkey'
    ) then
      alter table dqm_alert_preferences
        add constraint dqm_alert_preferences_organization_id_fkey
        foreign key (organization_id) references organizations(id) on delete cascade;
    end if;
  end if;
end
$$;

alter table dqm_alert_preferences enable row level security;

do $$ begin
  if exists (select from pg_tables where tablename = 'organisation_members') then
    execute $policy$
      create policy "dqm_alert_preferences_org_isolation"
        on dqm_alert_preferences
        using (
          organization_id in (
            select organisation_id from organisation_members where user_id = auth.uid()
          )
        )
    $policy$;
  end if;
end $$;
