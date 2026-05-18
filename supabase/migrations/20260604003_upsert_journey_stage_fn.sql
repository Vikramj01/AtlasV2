CREATE OR REPLACE FUNCTION upsert_journey_stage(
  p_journey_id                UUID,
  p_stage_order               INTEGER,
  p_label                     TEXT,
  p_page_type                 TEXT,
  p_sample_url                TEXT,
  p_actions                   TEXT[],
  p_conversion_event_metadata JSONB,
  p_proxy_value_gbp           NUMERIC,
  p_buyer_intent_level        TEXT
) RETURNS SETOF journey_stages
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  INSERT INTO journey_stages (
    journey_id, stage_order, label, page_type, sample_url,
    actions, conversion_event_metadata, proxy_value_gbp,
    buyer_intent_level, updated_at
  ) VALUES (
    p_journey_id, p_stage_order, p_label, p_page_type, p_sample_url,
    p_actions, p_conversion_event_metadata, p_proxy_value_gbp,
    p_buyer_intent_level, NOW()
  )
  ON CONFLICT (journey_id, stage_order) DO UPDATE SET
    label                     = EXCLUDED.label,
    page_type                 = EXCLUDED.page_type,
    sample_url                = EXCLUDED.sample_url,
    actions                   = EXCLUDED.actions,
    conversion_event_metadata = EXCLUDED.conversion_event_metadata,
    proxy_value_gbp           = EXCLUDED.proxy_value_gbp,
    buyer_intent_level        = EXCLUDED.buyer_intent_level,
    updated_at                = NOW()
  RETURNING *;
END;
$$;
