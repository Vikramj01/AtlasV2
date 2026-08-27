-- Campaign Signal Validator (B9, ATLAS_CONVERSION_SIGNAL_LAYER_SPRINT_PLAN.md)
--
-- Pre-flight diagnostic flagging weak/proxy primary conversion actions before
-- automated bidding (Google AI Max defaults on for Search from 1 Sept 2026)
-- scales whatever the primary conversion rewards. Two entry points share the
-- same run table:
--   - in_app:  authenticated org user, run against an existing client
--   - standalone: public, paid, one-time Stripe Checkout — no org required
--
-- signal_validator_purchases exists because the standalone flow is a one-time
-- purchase, not a plan-gated feature — nothing like this exists elsewhere in
-- the schema (billing.ts/subscriptionService.ts only handle recurring
-- pro/agency subscriptions).

create table if not exists signal_validator_runs (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid,
  client_id         uuid,
  source            text not null default 'in_app' check (source in ('in_app', 'standalone')),
  url               text not null,
  status            text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed')),
  site_detection    jsonb,
  verdict           jsonb,
  error_message     text,
  pdf_storage_path  text,
  created_at        timestamptz not null default now(),
  completed_at      timestamptz
);

create index if not exists idx_signal_validator_runs_org
  on signal_validator_runs (organization_id, created_at desc);

create index if not exists idx_signal_validator_runs_client
  on signal_validator_runs (client_id, created_at desc);

create table if not exists signal_validator_purchases (
  id                    uuid primary key default gen_random_uuid(),
  checkout_session_id   text not null unique,
  email                 text not null,
  url                   text not null,
  amount_cents          integer not null,
  currency              text not null default 'usd',
  status                text not null default 'pending' check (status in ('pending', 'paid', 'refunded')),
  run_id                uuid references signal_validator_runs(id) on delete set null,
  created_at            timestamptz not null default now(),
  paid_at               timestamptz
);

create index if not exists idx_signal_validator_purchases_session
  on signal_validator_purchases (checkout_session_id);

do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'organizations') then
    if not exists (
      select 1 from information_schema.table_constraints
      where table_name = 'signal_validator_runs'
        and constraint_name = 'signal_validator_runs_organization_id_fkey'
    ) then
      alter table signal_validator_runs
        add constraint signal_validator_runs_organization_id_fkey
        foreign key (organization_id) references organizations(id) on delete cascade;
    end if;
  end if;

  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'clients') then
    if not exists (
      select 1 from information_schema.table_constraints
      where table_name = 'signal_validator_runs'
        and constraint_name = 'signal_validator_runs_client_id_fkey'
    ) then
      alter table signal_validator_runs
        add constraint signal_validator_runs_client_id_fkey
        foreign key (client_id) references clients(id) on delete set null;
    end if;
  end if;
end
$$;

alter table signal_validator_runs enable row level security;
alter table signal_validator_purchases enable row level security;

-- In-app runs are org-scoped, same isolation pattern as ihc_alert_preferences.
do $$ begin
  if exists (select from pg_tables where tablename = 'organisation_members') then
    execute $policy$
      create policy "signal_validator_runs_org_isolation"
        on signal_validator_runs
        using (
          organization_id in (
            select organisation_id from organisation_members where user_id = auth.uid()
          )
        )
    $policy$;
  end if;
end $$;

-- Standalone runs (organization_id null) and all purchases are written/read
-- exclusively via the backend service role (public checkout + webhook flow,
-- no end-user Supabase session involved) — no public RLS policy needed here.
