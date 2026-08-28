-- Offline Signal Library Seeds
-- Adds two new system signals + two system packs for offline retail and B2B/CRM use cases.
-- Idempotent — uses ON CONFLICT DO NOTHING.
-- Requires: 20260619_001 (signals/signal_packs tables)
--           20260709_001 (signals.event_source column)

-- ── 1. System Signals ─────────────────────────────────────────────────────────

INSERT INTO signals (
  id, key, name, description, category,
  is_system, is_custom, event_source,
  source_action_primitive,
  required_params, optional_params,
  platform_mappings,
  version
)
VALUES

-- in_store_purchase
(
  'a1000009-0000-4000-8000-000000000009',
  'in_store_purchase',
  'In-Store Purchase',
  'A completed purchase at a physical retail location. Sent via server-side pipeline using POS transaction data.',
  'conversion',
  true, false, 'physical_store',
  'order_complete',
  '[
    {"key":"transaction_id","label":"Transaction ID","type":"string"},
    {"key":"value","label":"Purchase Value","type":"number"},
    {"key":"currency","label":"Currency Code","type":"string"}
  ]'::jsonb,
  '[
    {"key":"items","label":"Line Items","type":"array"},
    {"key":"user_email","label":"Customer Email","type":"string"},
    {"key":"user_phone","label":"Customer Phone","type":"string"},
    {"key":"external_id","label":"Loyalty / CRM ID","type":"string"}
  ]'::jsonb,
  '{
    "meta": {
      "event_name": "Purchase",
      "action_source": "physical_store",
      "param_mapping": {
        "value": "value",
        "currency": "currency"
      },
      "additional": {
        "content_type": "product"
      },
      "identity_fields": ["email","phone","external_id","first_name","last_name","postal_code","country"],
      "event_time_window_days": 62,
      "notes": "physical_store action_source grants 62-day attribution window on Meta"
    },
    "google": {
      "conversion_type": "STORE_SALES",
      "event_source": "IN_STORE",
      "identity_fields": ["email","phone","first_name","last_name","postal_code","country"],
      "event_time_window_days": 90,
      "notes": "Google Store Sales requires account allowlisting. Contact your Google rep before enabling."
    }
  }'::jsonb,
  1
),

-- crm_conversion
(
  'a1000010-0000-4000-8000-000000000010',
  'crm_conversion',
  'CRM Conversion',
  'A CRM pipeline stage event (e.g. SQL, Closed Won, Demo Completed) sent back to ad platforms for offline conversion import.',
  'conversion',
  true, false, 'system_generated',
  'crm_stage',
  '[
    {"key":"event_name","label":"CRM Stage Name (e.g. sql, closed_won)","type":"string"},
    {"key":"value","label":"Conversion Value","type":"number"},
    {"key":"currency","label":"Currency Code","type":"string"}
  ]'::jsonb,
  '[
    {"key":"user_email","label":"Contact Email","type":"string"},
    {"key":"user_phone","label":"Contact Phone","type":"string"},
    {"key":"external_id","label":"CRM Record ID","type":"string"},
    {"key":"lead_id","label":"Lead ID","type":"string"}
  ]'::jsonb,
  '{
    "meta": {
      "event_name": "Lead",
      "action_source": "system_generated",
      "param_mapping": {
        "value": "value",
        "currency": "currency"
      },
      "identity_fields": ["email","phone","fbc","external_id"],
      "event_time_window_days": 62,
      "notes": "Map to Lead for early pipeline stages (SQL) or Purchase for Closed Won"
    },
    "google": {
      "conversion_type": "UPLOAD_CLICKS",
      "event_source": "OTHER",
      "identity_fields": ["email","phone","gclid","first_name","last_name","postal_code","country"],
      "event_time_window_days": 90,
      "notes": "Enhanced Conversions for Leads — gclid must be captured at the original online touchpoint and stored in CRM"
    }
  }'::jsonb,
  1
)

ON CONFLICT (id) DO NOTHING;

-- ── 2. System Signal Packs ────────────────────────────────────────────────────

INSERT INTO signal_packs (
  id, name, description, business_type,
  is_system, version, signals_count
)
VALUES

(
  'b1000005-0000-4000-8000-000000000005',
  'Physical Retail',
  'Offline conversion tracking for retail clients: in-store purchases sent via server-side pipeline.',
  'retail',
  true, 1, 1
),

(
  'b1000006-0000-4000-8000-000000000006',
  'B2B / CRM Pipeline',
  'CRM-stage conversion tracking for B2B and SaaS clients: SQL, Closed Won, and other pipeline milestones.',
  'b2b',
  true, 1, 1
)

ON CONFLICT (id) DO NOTHING;

-- ── 3. Pack ↔ Signal Assignments ─────────────────────────────────────────────

INSERT INTO signal_pack_signals (pack_id, signal_id, stage_hint, is_required, display_order)
VALUES

('b1000005-0000-4000-8000-000000000005', 'a1000009-0000-4000-8000-000000000009', 'purchase', true, 1),
('b1000006-0000-4000-8000-000000000006', 'a1000010-0000-4000-8000-000000000010', 'conversion', true, 1)

ON CONFLICT (pack_id, signal_id) DO NOTHING;
