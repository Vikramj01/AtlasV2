-- OPT-03: Add missing indexes on high-traffic tables
-- Additive only — no data changes, no RLS changes, no table drops.

-- strategy_briefs: list view filters by org and sorts by created_at
CREATE INDEX IF NOT EXISTS idx_strategy_briefs_org_created
  ON strategy_briefs (organization_id, created_at DESC);

-- strategy_objectives: fetched by brief_id scoped to org
CREATE INDEX IF NOT EXISTS idx_strategy_objectives_brief_org
  ON strategy_objectives (brief_id, organization_id);

-- detected_signals: joined to crawl_pages by crawl_page_id
CREATE INDEX IF NOT EXISTS idx_detected_signals_page
  ON detected_signals (crawl_page_id);

-- offline_conversion_rows: batch status filter in bulkUpdateRowStatuses
CREATE INDEX IF NOT EXISTS idx_offline_conversion_rows_org_status
  ON offline_conversion_rows (organization_id, status);

-- reconciliation_findings: filter unresolved findings by org
CREATE INDEX IF NOT EXISTS idx_reconciliation_findings_org_resolved
  ON reconciliation_findings (organization_id, resolved_at)
  WHERE resolved_at IS NULL;

-- audit_findings: time-series IHC queries filter by org and created_at
CREATE INDEX IF NOT EXISTS idx_audit_findings_org_created
  ON audit_findings (organization_id, created_at DESC);

-- capi_events: queue processing queries filter by org and pending/processing status
CREATE INDEX IF NOT EXISTS idx_capi_events_org_status_pending
  ON capi_events (organization_id, status)
  WHERE status IN ('pending', 'processing');
