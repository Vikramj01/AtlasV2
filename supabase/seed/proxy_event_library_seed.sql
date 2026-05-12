-- ============================================================
-- Atlas: Proxy Event Library Seed Data
-- File: supabase/seed/proxy_event_library_seed.sql
--
-- Seeds the initial proxy event recommendations (is_system = true).
-- Run after applying migration 20260601_001_proxy_event_library.sql:
--   psql $DATABASE_URL -f supabase/seed/proxy_event_library_seed.sql
-- ============================================================

-- ─── B2B / LEAD GENERATION ────────────────────────────────────────────────────

INSERT INTO proxy_event_library (id, name, lag_class, platform_benefit, rationale, event_type, verticals, is_system) VALUES

  (
    'a0000000-0000-0000-0000-000000000001',
    'Form Submission',
    'short_lag',
    'both',
    'High-intent, measurable within session or same day.',
    'generate_lead',
    ARRAY['lead_gen', 'saas'],
    true
  ),

  (
    'a0000000-0000-0000-0000-000000000002',
    'Demo / Meeting Booked',
    'short_lag',
    'both',
    'Strong purchase intent signal, typically fires within 24h of ad click.',
    'generate_lead',
    ARRAY['lead_gen', 'saas'],
    true
  ),

  (
    'a0000000-0000-0000-0000-000000000003',
    'Trial Account Created',
    'short_lag',
    'both',
    'Product-qualified lead that correlates strongly with eventual paid conversion.',
    'sign_up',
    ARRAY['saas'],
    true
  ),

  (
    'a0000000-0000-0000-0000-000000000004',
    'Pricing Page Viewed (2+ times)',
    'immediate',
    'meta',
    'Repeat pricing visits indicate active evaluation stage — fires immediately.',
    'view_item',
    ARRAY['lead_gen', 'saas'],
    true
  ),

  (
    'a0000000-0000-0000-0000-000000000005',
    'Gated Content Download',
    'short_lag',
    'both',
    'Willingness to exchange data signals active consideration of the product.',
    'generate_lead',
    ARRAY['lead_gen', 'saas', 'content'],
    true
  ),

  (
    'a0000000-0000-0000-0000-000000000006',
    'MQL (CRM Event)',
    'long_lag',
    'google',
    'Sales-validated intent signal; acceptable lag for Google Smart Bidding feedback loops.',
    'generate_lead',
    ARRAY['lead_gen', 'saas'],
    true
  ),

  (
    'a0000000-0000-0000-0000-000000000007',
    'SQL (CRM Event)',
    'long_lag',
    'google',
    'Higher predictive value than MQL for closed-won outcomes; use as secondary Google signal.',
    'generate_lead',
    ARRAY['lead_gen', 'saas'],
    true
  ),

  (
    'a0000000-0000-0000-0000-000000000008',
    'Proposal / Quote Viewed',
    'long_lag',
    'google',
    'Late-stage indicator; use as secondary optimisation signal on Google where lag is acceptable.',
    'view_item',
    ARRAY['lead_gen', 'saas'],
    true
  ),

-- ─── B2C / E-COMMERCE ─────────────────────────────────────────────────────────

  (
    'a0000000-0000-0000-0000-000000000009',
    'Add to Cart',
    'immediate',
    'both',
    'Strongest pre-purchase intent signal available; fires within the same session.',
    'add_to_cart',
    ARRAY['ecommerce', 'marketplace'],
    true
  ),

  (
    'a0000000-0000-0000-0000-000000000010',
    'Initiate Checkout',
    'immediate',
    'both',
    'Highest pre-purchase intent signal; user has committed to the checkout funnel.',
    'begin_checkout',
    ARRAY['ecommerce', 'marketplace'],
    true
  ),

  (
    'a0000000-0000-0000-0000-000000000011',
    'Product Detail Page (3+ Views)',
    'immediate',
    'meta',
    'Repeat product evaluation within session correlates strongly with purchase intent.',
    'view_item',
    ARRAY['ecommerce', 'marketplace'],
    true
  ),

  (
    'a0000000-0000-0000-0000-000000000012',
    'Wishlist / Save Item',
    'immediate',
    'meta',
    'Explicit intent signal that fires immediately, indicating deferred purchase consideration.',
    'view_item',
    ARRAY['ecommerce'],
    true
  ),

  (
    'a0000000-0000-0000-0000-000000000013',
    'Account Created',
    'short_lag',
    'both',
    'Commitment signal that typically precedes a first purchase; reliable conversion predictor.',
    'sign_up',
    ARRAY['ecommerce', 'marketplace'],
    true
  ),

-- ─── SUBSCRIPTION / SAAS ──────────────────────────────────────────────────────

  (
    'a0000000-0000-0000-0000-000000000014',
    'Free Trial Started',
    'short_lag',
    'both',
    'Direct product engagement; the single strongest predictor of trial-to-paid conversion.',
    'sign_up',
    ARRAY['saas'],
    true
  ),

  (
    'a0000000-0000-0000-0000-000000000015',
    'Onboarding Step Completed',
    'short_lag',
    'both',
    'Activation signal that correlates with trial-to-paid conversion; fires within hours of signup.',
    'sign_up',
    ARRAY['saas'],
    true
  ),

  (
    'a0000000-0000-0000-0000-000000000016',
    'Key Feature Used',
    'short_lag',
    'google',
    'Usage-based intent that signals genuine product engagement; requires product analytics integration.',
    'view_item',
    ARRAY['saas'],
    true
  ),

  (
    'a0000000-0000-0000-0000-000000000017',
    'Subscription / Upgrade Page Viewed',
    'immediate',
    'meta',
    'Upgrade consideration signal firing immediately; strengthens Meta signal pool for paid tiers.',
    'view_item',
    ARRAY['saas'],
    true
  )

ON CONFLICT DO NOTHING;
