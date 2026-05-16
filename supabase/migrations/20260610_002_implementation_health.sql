-- Implementation Health Checks (IHC) — Sprint A1
-- New tables: gtm_container_connections, gtm_container_snapshots,
--             ihc_alert_preferences, audit_findings
-- Extension:  crawl_runs gains is_baseline flag
--
-- FK constraints to organizations and clients are applied conditionally so this
-- migration survives Supabase preview branches and CI environments where those
-- tables may not exist yet. Pattern matches the is_baseline guard below.

-- ── gtm_container_connections ────────────────────────────────────────────────
-- One row per GTM container connected to a property.
-- oauth_credentials_encrypted stores AES-256-GCM envelope (same format as capi_providers).

create table if not exists gtm_container_connections (
  id                              uuid primary key default gen_random_uuid(),
  organization_id                 uuid not null,
  client_id                       uuid,
  property_id                     uuid not null,
  container_id                    text not null,
  account_id                      text,
  auth_method                     text not null check (auth_method in ('oauth', 'manual_upload')),
  oauth_credentials_encrypted     text,
  last_synced_at                  timestamptz,
  last_container_json_snapshot_id uuid,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now()
);

-- Add FK to organizations if the table exists
do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'organizations') then
    if not exists (
      select 1 from information_schema.table_constraints
      where table_name = 'gtm_container_connections'
        and constraint_name = 'gtm_container_connections_organization_id_fkey'
    ) then
      alter table gtm_container_connections
        add constraint gtm_container_connections_organization_id_fkey
        foreign key (organization_id) references organizations(id) on delete cascade;
    end if;
  end if;
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'clients') then
    if not exists (
      select 1 from information_schema.table_constraints
      where table_name = 'gtm_container_connections'
        and constraint_name = 'gtm_container_connections_client_id_fkey'
    ) then
      alter table gtm_container_connections
        add constraint gtm_container_connections_client_id_fkey
        foreign key (client_id) references clients(id) on delete set null;
    end if;
  end if;
end
$$;

alter table gtm_container_connections enable row level security;

create policy "gtm_container_connections_org_isolation"
  on gtm_container_connections
  using (
    organization_id = (
      select organization_id from profiles where id = auth.uid()
    )
  );

create index if not exists idx_gtm_connections_org
  on gtm_container_connections (organization_id);

create index if not exists idx_gtm_connections_property
  on gtm_container_connections (property_id);

-- ── gtm_container_snapshots ──────────────────────────────────────────────────
-- Versioned container JSON snapshots. is_active = true marks the current version.

create table if not exists gtm_container_snapshots (
  id               uuid primary key default gen_random_uuid(),
  connection_id    uuid not null references gtm_container_connections(id) on delete cascade,
  organization_id  uuid not null,
  container_json   jsonb not null,
  container_version text,
  snapshot_at      timestamptz not null default now(),
  is_active        boolean not null default true
);

do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'organizations') then
    if not exists (
      select 1 from information_schema.table_constraints
      where table_name = 'gtm_container_snapshots'
        and constraint_name = 'gtm_container_snapshots_organization_id_fkey'
    ) then
      alter table gtm_container_snapshots
        add constraint gtm_container_snapshots_organization_id_fkey
        foreign key (organization_id) references organizations(id) on delete cascade;
    end if;
  end if;
end
$$;

alter table gtm_container_snapshots enable row level security;

create policy "gtm_container_snapshots_org_isolation"
  on gtm_container_snapshots
  using (
    organization_id = (
      select organization_id from profiles where id = auth.uid()
    )
  );

create index if not exists idx_gtm_snapshots_connection
  on gtm_container_snapshots (connection_id);

create index if not exists idx_gtm_snapshots_org_active
  on gtm_container_snapshots (organization_id, is_active);

-- ── ihc_alert_preferences ────────────────────────────────────────────────────
-- One row per org; INSERT on first save, UPDATE thereafter.

create table if not exists ihc_alert_preferences (
  id                           uuid primary key default gen_random_uuid(),
  organization_id              uuid not null unique,
  email_critical_enabled       boolean not null default true,
  email_high_digest_enabled    boolean not null default true,
  email_medium_digest_enabled  boolean not null default true,
  email_low_enabled            boolean not null default false,
  digest_timezone              text not null default 'UTC',
  daily_digest_hour            int  not null default 9,
  weekly_digest_day            int  not null default 1,
  weekly_digest_hour           int  not null default 9,
  critical_alert_batch_minutes int  not null default 15,
  recipient_user_ids           uuid[] not null default '{}',
  paused_properties            uuid[] not null default '{}',
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now()
);

do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'organizations') then
    if not exists (
      select 1 from information_schema.table_constraints
      where table_name = 'ihc_alert_preferences'
        and constraint_name = 'ihc_alert_preferences_organization_id_fkey'
    ) then
      alter table ihc_alert_preferences
        add constraint ihc_alert_preferences_organization_id_fkey
        foreign key (organization_id) references organizations(id) on delete cascade;
    end if;
  end if;
end
$$;

alter table ihc_alert_preferences enable row level security;

create policy "ihc_alert_preferences_org_isolation"
  on ihc_alert_preferences
  using (
    organization_id = (
      select organization_id from profiles where id = auth.uid()
    )
  );

-- ── audit_findings ───────────────────────────────────────────────────────────
-- Persistent finding store, cross-run. One row per (property, rule) with
-- status transitions tracked via status + first/last_seen timestamps.

create table if not exists audit_findings (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  client_id        uuid,
  property_id      uuid not null,
  rule_id          text not null,
  validation_layer text not null,
  severity         text not null check (severity in ('critical', 'high', 'medium', 'low')),
  status           text not null default 'open'
                     check (status in ('open', 'acknowledged', 'resolved', 'suppressed')),
  evidence         jsonb not null default '{}',
  resolution_note  text,
  suppressed_until timestamptz,
  first_detected_at timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  resolved_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'organizations') then
    if not exists (
      select 1 from information_schema.table_constraints
      where table_name = 'audit_findings'
        and constraint_name = 'audit_findings_organization_id_fkey'
    ) then
      alter table audit_findings
        add constraint audit_findings_organization_id_fkey
        foreign key (organization_id) references organizations(id) on delete cascade;
    end if;
  end if;
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'clients') then
    if not exists (
      select 1 from information_schema.table_constraints
      where table_name = 'audit_findings'
        and constraint_name = 'audit_findings_client_id_fkey'
    ) then
      alter table audit_findings
        add constraint audit_findings_client_id_fkey
        foreign key (client_id) references clients(id) on delete set null;
    end if;
  end if;
end
$$;

alter table audit_findings enable row level security;

create policy "audit_findings_org_isolation"
  on audit_findings
  using (
    organization_id = (
      select organization_id from profiles where id = auth.uid()
    )
  );

create index if not exists idx_audit_findings_org_status
  on audit_findings (organization_id, status);

create index if not exists idx_audit_findings_property_severity
  on audit_findings (property_id, severity);

create index if not exists idx_audit_findings_rule
  on audit_findings (rule_id);

-- ── crawl_runs — is_baseline extension ───────────────────────────────────────
-- Wraps ALTER TABLE in existence guard for Supabase preview environments.

do $$
begin
  if exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = 'crawl_runs'
  ) then
    if not exists (
      select 1 from information_schema.columns
      where table_name = 'crawl_runs' and column_name = 'is_baseline'
    ) then
      alter table crawl_runs add column is_baseline boolean not null default false;
    end if;
  end if;
end
$$;

-- Partial index — only created if crawl_runs exists (guarded by the DO block above).
-- create index if not exists is safe even if column doesn't exist yet because
-- Supabase runs the whole file; if the DO block above succeeded the column is present.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'crawl_runs' and column_name = 'is_baseline'
  ) then
    execute $idx$
      create index if not exists idx_crawl_runs_baseline
        on crawl_runs (org_id, is_baseline)
        where is_baseline = true
    $idx$;
  end if;
end
$$;
