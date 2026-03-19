import 'dotenv/config';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

const NODE_ENV = optional('NODE_ENV', 'development');

// FRONTEND_URL is required in production to prevent the CORS origin from
// silently falling back to localhost (which would block all real browser requests).
const FRONTEND_URL =
  NODE_ENV === 'production'
    ? requireEnv('FRONTEND_URL')
    : optional('FRONTEND_URL', 'http://localhost:5173');

export const env = {
  SUPABASE_URL: requireEnv('SUPABASE_URL'),
  SUPABASE_ANON_KEY: requireEnv('SUPABASE_ANON_KEY'),
  SUPABASE_SERVICE_ROLE_KEY: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),

  REDIS_URL: requireEnv('REDIS_URL'),

  BROWSERBASE_API_KEY: requireEnv('BROWSERBASE_API_KEY'),
  BROWSERBASE_PROJECT_ID: requireEnv('BROWSERBASE_PROJECT_ID'),
  BROWSERBASE_USE_PROXIES: optional('BROWSERBASE_USE_PROXIES', 'true') === 'true',

  ANTHROPIC_API_KEY: requireEnv('ANTHROPIC_API_KEY'),

  STRIPE_SECRET_KEY: optional('STRIPE_SECRET_KEY', ''),
  STRIPE_WEBHOOK_SECRET: optional('STRIPE_WEBHOOK_SECRET', ''),

  // CAPI credential encryption — 32-byte hex key (64 hex chars = 256 bits)
  // Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  CAPI_ENCRYPTION_KEY: optional('CAPI_ENCRYPTION_KEY', ''),

  // Google Ads OAuth — required for token refresh on Google Enhanced Conversions
  GOOGLE_OAUTH_CLIENT_ID: optional('GOOGLE_OAUTH_CLIENT_ID', ''),
  GOOGLE_OAUTH_CLIENT_SECRET: optional('GOOGLE_OAUTH_CLIENT_SECRET', ''),
  // Developer token required for every Google Ads API request
  GOOGLE_ADS_DEVELOPER_TOKEN: optional('GOOGLE_ADS_DEVELOPER_TOKEN', ''),

  // Email — Resend (https://resend.com). Optional: emails are silently skipped if not set.
  RESEND_API_KEY: optional('RESEND_API_KEY', ''),
  FROM_EMAIL: optional('FROM_EMAIL', 'Atlas <notifications@getatlas.io>'),

  PORT: parseInt(optional('PORT', '3001'), 10),
  NODE_ENV,
  FRONTEND_URL,

  // Queue worker concurrency — tune to match your Browserbase session quota.
  // Each concurrent audit/planning job opens one Browserbase session.
  // Default: 2 audit workers, 1 planning worker (conservative for Hobby Browserbase plan).
  AUDIT_WORKER_CONCURRENCY: parseInt(optional('AUDIT_WORKER_CONCURRENCY', '2'), 10),
  PLANNING_WORKER_CONCURRENCY: parseInt(optional('PLANNING_WORKER_CONCURRENCY', '1'), 10),
} as const;
