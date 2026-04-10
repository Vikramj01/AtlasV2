-- Migration: 20260409_001_stripe_subscriptions
-- Add Stripe billing columns to the profiles table.
-- Plan is already stored on profiles; Stripe metadata lives alongside it.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS stripe_customer_id       TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id   TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS subscription_status      TEXT NOT NULL DEFAULT 'inactive',
  ADD COLUMN IF NOT EXISTS current_period_end       TIMESTAMPTZ;

-- Fast lookups from webhook payloads (customer / subscription ID → profile row)
CREATE INDEX IF NOT EXISTS profiles_stripe_customer_id_idx
  ON profiles (stripe_customer_id);

CREATE INDEX IF NOT EXISTS profiles_stripe_subscription_id_idx
  ON profiles (stripe_subscription_id);

-- Constrain subscription_status to known values
ALTER TABLE profiles
  ADD CONSTRAINT profiles_subscription_status_check
  CHECK (subscription_status IN ('inactive', 'active', 'trialing', 'past_due', 'canceled'));
