-- Migration: 20260409_001_stripe_subscriptions
-- Add Stripe billing columns to the profiles table.
-- Plan is already stored on profiles; Stripe metadata lives alongside it.

-- Guarded: profiles is not created by a migration; skip if it doesn't exist yet.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'profiles') THEN
    EXECUTE $q$
      ALTER TABLE profiles
        ADD COLUMN IF NOT EXISTS stripe_customer_id       TEXT UNIQUE,
        ADD COLUMN IF NOT EXISTS stripe_subscription_id   TEXT UNIQUE,
        ADD COLUMN IF NOT EXISTS subscription_status      TEXT NOT NULL DEFAULT 'inactive',
        ADD COLUMN IF NOT EXISTS current_period_end       TIMESTAMPTZ
    $q$;

    EXECUTE 'CREATE INDEX IF NOT EXISTS profiles_stripe_customer_id_idx ON profiles (stripe_customer_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS profiles_stripe_subscription_id_idx ON profiles (stripe_subscription_id)';

    EXECUTE 'ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_subscription_status_check';
    EXECUTE $q$
      ALTER TABLE profiles
        ADD CONSTRAINT profiles_subscription_status_check
        CHECK (subscription_status IN ('inactive', 'active', 'trialing', 'past_due', 'canceled'))
    $q$;
  END IF;
END $$;
