-- Phase 1: Consent-in-Planning Integration
-- Adds consent_config_id to planning_sessions so that generated GTM
-- containers can include the correct Consent Mode v2 update tag.
--
-- Run in Supabase SQL editor: Dashboard → SQL Editor → New Query → paste → Run

ALTER TABLE planning_sessions
  ADD COLUMN IF NOT EXISTS consent_config_id UUID REFERENCES consent_configs(id) ON DELETE SET NULL;

COMMENT ON COLUMN planning_sessions.consent_config_id IS
  'Optional link to the consent_configs record for this session''s site. When set, generated GTM containers include a Consent Mode v2 update tag wired to the configured CMP.';
