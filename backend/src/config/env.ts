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

  PORT: parseInt(optional('PORT', '3001'), 10),
  NODE_ENV: optional('NODE_ENV', 'development'),
} as const;
