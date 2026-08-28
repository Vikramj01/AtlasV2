-- Migration: 20260611_001_audience_member_uploads
-- Creates the audience_member_uploads table for tracking Customer Match ingest batches.

CREATE TABLE IF NOT EXISTS audience_member_uploads (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid        NOT NULL,
  customer_id    text        NOT NULL,
  operation_type text        NOT NULL DEFAULT 'CREATE',
  status         text        NOT NULL DEFAULT 'completed',
  record_count   integer     NOT NULL DEFAULT 0,
  matched_count  integer,
  failed_count   integer,
  dma_response   jsonb,
  error_message  text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE audience_member_uploads ENABLE ROW LEVEL SECURITY;

-- Guard the policy creation behind an IF EXISTS check on organisation_members.
-- This makes the migration safe in Supabase preview environments where the
-- organisation_members table may not yet exist.
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'organisation_members') THEN
    EXECUTE $policy$
      CREATE POLICY "org members can access their audience uploads"
        ON audience_member_uploads
        FOR ALL
        USING (
          org_id IN (
            SELECT organisation_id
            FROM   organisation_members
            WHERE  user_id = auth.uid()
          )
        )
    $policy$;
  END IF;
END $$;
