import 'dotenv/config';

function require(name: string): string {
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
  SUPABASE_URL: require('SUPABASE_URL'),
  SUPABASE_ANON_KEY: require('SUPABASE_ANON_KEY'),
  SUPABASE_SERVICE_ROLE_KEY: require('SUPABASE_SERVICE_ROLE_KEY'),

  REDIS_URL: require('REDIS_URL'),

  BROWSERBASE_API_KEY: require('BROWSERBASE_API_KEY'),
  BROWSERBASE_PROJECT_ID: require('BROWSERBASE_PROJECT_ID'),

  STRIPE_SECRET_KEY: optional('STRIPE_SECRET_KEY', ''),
  STRIPE_WEBHOOK_SECRET: optional('STRIPE_WEBHOOK_SECRET', ''),

  PORT: parseInt(optional('PORT', '3001'), 10),
  NODE_ENV: optional('NODE_ENV', 'development'),
} as const;
