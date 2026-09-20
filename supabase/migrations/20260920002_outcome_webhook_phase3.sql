-- Universal Outcome Ingestion Phase 3 — inbound webhook, input tiers, delivery
-- gate (docs/prd/universal-outcome-ingestion.md §6). Verified immediately
-- before writing this migration: outcome_source_configs and outcome_events
-- both still at zero rows in production (Key Technical Decision §21/§22's
-- read-before-widen discipline — live constraints/columns read directly, not
-- reconstructed from memory).

-- ── connection_id becomes nullable ───────────────────────────────────────────
-- A webhook-type config has no OAuth connection at all — nothing to
-- authenticate outward with, since Atlas is the one receiving calls. Every
-- existing pull source (hubspot/salesforce) still requires one; application
-- code enforces that, not this column (a webhook config simply never sets it).
ALTER TABLE outcome_source_configs ALTER COLUMN connection_id DROP NOT NULL;

-- ── Webhook secret ────────────────────────────────────────────────────────────
-- AES-256-GCM encrypted at rest (Implementation Rule 2), same envelope shape
-- as capi/credentials.ts and api/routes/slack.ts's own webhook-URL encryption
-- (iv/tag/ciphertext JSON, CAPI_ENCRYPTION_KEY). NULL for a pull source.
ALTER TABLE outcome_source_configs ADD COLUMN webhook_secret_encrypted TEXT;

-- ── Delivery gate (§6.3) ──────────────────────────────────────────────────────
-- Deliberately separate from sync_enabled, which stays pull-polling-specific
-- and unchanged in meaning (a pull source's sync_enabled continues to gate
-- both polling AND delivery together, exactly as before this migration — zero
-- behavior change for hubspot/salesforce). delivery_enabled is the new,
-- source-type-agnostic concept Phase 3 needs: whether an outcome source's
-- resolved records are actually attempted for live delivery, vs. persisted
-- and counted only. Auto-disabled (not merely alerted on) the moment a
-- delivery-enabled source's tier-3 (unresolved-identity) rate crosses
-- threshold — services/outcomes/deliveryGate.ts, checked inline after each
-- webhook ingest rather than on a polling cadence, since a push source's
-- tier composition only changes when a new record actually arrives.
ALTER TABLE outcome_source_configs ADD COLUMN delivery_enabled BOOLEAN NOT NULL DEFAULT false;
-- Set (and visible to the operator) when the gate above auto-disables
-- delivery; cleared back to NULL the next time delivery_enabled is
-- successfully turned back on. Never a health_alerts row for this in Phase 3
-- — this column is the single, sufficient "fully inspectable by an operator"
-- surface the PRD's acceptance criterion 20 asks for; wiring a dedicated
-- alert can follow later if wanted.
ALTER TABLE outcome_source_configs ADD COLUMN delivery_disabled_reason TEXT;

-- ── outcome_events.delivery_status: new skipped_delivery_disabled value ──────
-- Live constraint read directly above (crm_outcome_events_delivery_status_check
-- — untouched, and therefore still named for the pre-rename table, by every
-- migration since Phase 1). Every previously-existing value is carried
-- forward unchanged.
ALTER TABLE outcome_events DROP CONSTRAINT crm_outcome_events_delivery_status_check;
ALTER TABLE outcome_events ADD CONSTRAINT crm_outcome_events_delivery_status_check
  CHECK (delivery_status = ANY (ARRAY[
    'pending'::text, 'delivered'::text, 'partial'::text, 'failed'::text,
    'skipped_unresolved'::text, 'skipped_window'::text, 'dedup_skipped'::text,
    'skipped_delivery_disabled'::text
  ]));
