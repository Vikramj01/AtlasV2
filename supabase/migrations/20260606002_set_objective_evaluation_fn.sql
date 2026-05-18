CREATE OR REPLACE FUNCTION set_objective_evaluation(
  p_objective_id            UUID,
  p_org_id                  UUID,
  p_verdict                 TEXT,
  p_outcome_category        TEXT,
  p_recommended_primary_event TEXT,
  p_recommended_proxy_event TEXT,
  p_proxy_event_required    BOOLEAN,
  p_rationale               TEXT,
  p_summary_markdown        TEXT,
  p_conversion_tier         TEXT,
  p_platform_action_types   JSONB
) RETURNS SETOF strategy_objectives
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  UPDATE strategy_objectives
  SET
    verdict                     = p_verdict,
    outcome_category            = p_outcome_category,
    recommended_primary_event   = p_recommended_primary_event,
    recommended_proxy_event     = p_recommended_proxy_event,
    proxy_event_required        = p_proxy_event_required,
    rationale                   = p_rationale,
    summary_markdown            = p_summary_markdown,
    conversion_tier             = p_conversion_tier,
    platform_action_types       = p_platform_action_types,
    updated_at                  = NOW()
  WHERE id              = p_objective_id
    AND organization_id = p_org_id
  RETURNING *;
END;
$$;
