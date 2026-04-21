-- Sprint 2.1: Remove WalkerOS from database constraints
-- Migrate existing walkeros/both journeys to gtm, update CHECK constraints

-- 1. Migrate existing journey rows
UPDATE journeys
SET implementation_format = 'gtm'
WHERE implementation_format IN ('walkeros', 'both');

-- 2. Update journeys CHECK constraint
ALTER TABLE journeys
  DROP CONSTRAINT IF EXISTS journeys_implementation_format_check;

ALTER TABLE journeys
  ADD CONSTRAINT journeys_implementation_format_check
  CHECK (implementation_format IN ('gtm'));

-- 3. Migrate any planning_outputs with walkeros_flow output_type
UPDATE planning_outputs
SET output_type = 'implementation_guide'
WHERE output_type = 'walkeros_flow';

-- 4. Update planning_outputs CHECK constraint if it exists
ALTER TABLE planning_outputs
  DROP CONSTRAINT IF EXISTS planning_outputs_output_type_check;

ALTER TABLE planning_outputs
  ADD CONSTRAINT planning_outputs_output_type_check
  CHECK (output_type IN ('gtm_container', 'datalayer_spec', 'implementation_guide'));

-- 5. Migrate client_outputs walkeros_flow rows
UPDATE client_outputs
SET output_type = 'datalayer_spec'
WHERE output_type = 'walkeros_flow';

-- 6. Update client_outputs CHECK constraint if it exists
ALTER TABLE client_outputs
  DROP CONSTRAINT IF EXISTS client_outputs_output_type_check;

ALTER TABLE client_outputs
  ADD CONSTRAINT client_outputs_output_type_check
  CHECK (output_type IN ('gtm_container', 'datalayer_spec', 'implementation_guide'));
