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

  PORT: parseInt(optional('PORT', '3001'), 10),
  NODE_ENV,
  FRONTEND_URL,
} as const;
