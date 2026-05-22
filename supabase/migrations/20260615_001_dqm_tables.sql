-- DQM tables: GTG path health probe results and DMA poll state.
-- Both tables use org_id (not organization_id) for consistency with enricher_runs.

create table if not exists dqm_gtg_checks (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null,
  gtag_url         text not null,
  http_status      integer,
  response_ms      integer,
  check_status     text not null check (check_status in ('pass', 'fail', 'timeout', 'error')),
  error_message    text,
  checked_at       timestamptz not null default now()
);

create table if not exists dqm_dma_poll_state (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null unique,
  last_polled_at        timestamptz,
  last_successful_at    timestamptz,
  upload_success_rate   numeric(5,2),
  avg_match_rate        numeric(5,2),
  total_members_30d     integer not null default 0,
  destination_count     integer not null default 0,
  error_categories      jsonb not null default '{}',
  backoff_until         timestamptz,
  updated_at            timestamptz not null default now()
);

-- Indexes
create index if not exists idx_dqm_gtg_checks_org_time on dqm_gtg_checks (org_id, checked_at desc);
create index if not exists idx_dqm_dma_poll_org on dqm_dma_poll_state (org_id);

-- RLS
alter table dqm_gtg_checks enable row level security;
alter table dqm_dma_poll_state enable row level security;

-- Policies guarded on organisation_members existence (same pattern as prior migrations)
do $$
begin
  if exists (
    select from pg_tables
    where schemaname = 'public'
      and tablename  = 'organisation_members'
  ) then
    if not exists (
      select from pg_policies
      where tablename  = 'dqm_gtg_checks'
        and policyname = 'dqm_gtg_checks_org_access'
    ) then
      execute $p$
        create policy dqm_gtg_checks_org_access on dqm_gtg_checks
          using (org_id = auth.uid());
      $p$;
    end if;

    if not exists (
      select from pg_policies
      where tablename  = 'dqm_dma_poll_state'
        and policyname = 'dqm_dma_poll_state_org_access'
    ) then
      execute $p$
        create policy dqm_dma_poll_state_org_access on dqm_dma_poll_state
          using (org_id = auth.uid());
      $p$;
    end if;
  end if;
end $$;
