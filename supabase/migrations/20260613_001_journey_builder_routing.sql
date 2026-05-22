-- Sprint 6: Journey Builder Routing — add transport_layer and gtg_preflight_dismissed
-- to journey_stages table. Wrapped in DO/IF EXISTS guards for Supabase preview safety.

do $$ begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'journey_stages') then
    if not exists (select 1 from information_schema.columns where table_name = 'journey_stages' and column_name = 'transport_layer') then
      alter table journey_stages add column transport_layer jsonb;
    end if;
  end if;
end $$;

do $$ begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'journey_stages') then
    if not exists (select 1 from information_schema.columns where table_name = 'journey_stages' and column_name = 'gtg_preflight_dismissed') then
      alter table journey_stages add column gtg_preflight_dismissed boolean default false;
    end if;
  end if;
end $$;
