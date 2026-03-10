-- Migration 004: Add test_email / test_phone to audits table.
--
-- These fields are optional and only used during the Browserbase journey simulation
-- to fill checkout forms. Storing them in the DB (rather than in the Redis queue
-- payload) ensures PII is kept in Supabase (encrypted at rest, access-controlled
-- via RLS) rather than exposed in plaintext inside Bull job records.
--
-- Run after 001_create_audit_tables.sql.

ALTER TABLE public.audits
  ADD COLUMN IF NOT EXISTS test_email TEXT,
  ADD COLUMN IF NOT EXISTS test_phone TEXT;
