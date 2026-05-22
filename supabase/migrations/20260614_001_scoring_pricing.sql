-- Sprint 7: GTG/DMA scoring & pricing integration
-- Extends usage_events constraint, adds gtg_active + dma_coverage_score to health tables

-- A. Extend usage_events CHECK constraint to allow new DMA event types
do $$ begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'usage_events') then
    alter table usage_events drop constraint if exists usage_events_event_type_check;
    alter table usage_events add constraint usage_events_event_type_check
      check (event_type in (
        'page_scan',
        'ai_report_scheduled',
        'ai_report_ondemand',
        'ai_query_ondemand',
        'dma_ingest_event',
        'dma_enricher_event'
      ));
  end if;
end $$;

-- B. Add GTG and DMA columns to health_scores
do $$ begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'health_scores') then
    if not exists (select 1 from information_schema.columns where table_name = 'health_scores' and column_name = 'gtg_active') then
      alter table health_scores add column gtg_active boolean not null default false;
    end if;
    if not exists (select 1 from information_schema.columns where table_name = 'health_scores' and column_name = 'dma_coverage_score') then
      alter table health_scores add column dma_coverage_score numeric(5,2);
    end if;
  end if;
end $$;

-- C. Add GTG and DMA columns to health_snapshots
do $$ begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'health_snapshots') then
    if not exists (select 1 from information_schema.columns where table_name = 'health_snapshots' and column_name = 'gtg_active') then
      alter table health_snapshots add column gtg_active boolean;
    end if;
    if not exists (select 1 from information_schema.columns where table_name = 'health_snapshots' and column_name = 'dma_coverage_score') then
      alter table health_snapshots add column dma_coverage_score numeric(5,2);
    end if;
  end if;
end $$;
