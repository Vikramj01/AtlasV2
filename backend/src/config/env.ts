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

// FRONTEND_URL accepts a single URL or a comma-separated list of URLs.
// The first value is used as the canonical frontend URL (e.g. for redirect links).
// All values are added to the CORS allowlist.
// In production this is required — omitting it would silently fall back to
// localhost and block all real browser requests.
const FRONTEND_URL_RAW =
  NODE_ENV === 'production'
    ? requireEnv('FRONTEND_URL')
    : optional('FRONTEND_URL', 'http://localhost:5173');

const ALLOWED_ORIGINS = FRONTEND_URL_RAW
  .split(',')
  .map((u) => u.trim())
  .filter(Boolean);

const FRONTEND_URL = ALLOWED_ORIGINS[0];

export const env = {
  SUPABASE_URL: requireEnv('SUPABASE_URL'),
  SUPABASE_ANON_KEY: requireEnv('SUPABASE_ANON_KEY'),
  SUPABASE_SERVICE_ROLE_KEY: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),

  REDIS_URL: requireEnv('REDIS_URL'),

  BROWSERBASE_API_KEY: requireEnv('BROWSERBASE_API_KEY'),
  BROWSERBASE_PROJECT_ID: requireEnv('BROWSERBASE_PROJECT_ID'),
  // Proxies are OFF by default — they consume ~5–15 MB per page from the 1 GB/month
  // allowance ($12/GB overage). Enable only if scans are being blocked by anti-bot
  // protection on the target site. Set BROWSERBASE_USE_PROXIES=true in Render env vars.
  BROWSERBASE_USE_PROXIES: optional('BROWSERBASE_USE_PROXIES', 'false') === 'true',

  ANTHROPIC_API_KEY: requireEnv('ANTHROPIC_API_KEY'),

  STRIPE_SECRET_KEY: optional('STRIPE_SECRET_KEY', ''),
  STRIPE_WEBHOOK_SECRET: optional('STRIPE_WEBHOOK_SECRET', ''),
  // Price IDs from the Stripe dashboard — required for checkout sessions.
  // Pro:    Stripe dashboard → Products → Pro plan → Price ID
  // Agency: Stripe dashboard → Products → Agency plan → Price ID
  STRIPE_PRICE_PRO: optional('STRIPE_PRICE_PRO', ''),
  STRIPE_PRICE_AGENCY: optional('STRIPE_PRICE_AGENCY', ''),

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
  FRONTEND_URL,      // canonical URL used in redirect links / emails
  ALLOWED_ORIGINS,   // all origins permitted by CORS (parsed from FRONTEND_URL)

  // Queue worker concurrency — tune to match your Browserbase session quota.
  // Each concurrent audit/planning job opens one Browserbase session.
  // Default: 2 audit workers, 1 planning worker (conservative for Hobby Browserbase plan).
  AUDIT_WORKER_CONCURRENCY: parseInt(optional('AUDIT_WORKER_CONCURRENCY', '2'), 10),
  PLANNING_WORKER_CONCURRENCY: parseInt(optional('PLANNING_WORKER_CONCURRENCY', '1'), 10),

  // Admin module — comma-separated list of email addresses with admin access.
  // Example: ADMIN_EMAILS=alice@example.com,bob@example.com
  ADMIN_EMAILS: optional('ADMIN_EMAILS', '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),

  // Super admin accounts — full platform access, no billing required.
  // These accounts bypass all plan gates. Keep this list to 2–3 trusted emails.
  // Example: SUPER_ADMIN_EMAILS=founder@example.com,cto@example.com
  SUPER_ADMIN_EMAILS: optional('SUPER_ADMIN_EMAILS', '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
} as const;
