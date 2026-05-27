-- Fix: recreate org_active_subscriptions with SECURITY INVOKER so that
-- RLS policies apply to the querying user, not the view owner.
CREATE OR REPLACE VIEW org_active_subscriptions
  WITH (security_invoker = on)
AS
SELECT DISTINCT ON (org_id) *
FROM org_subscriptions
WHERE status IN ('trial', 'active')
ORDER BY org_id, started_at DESC;
