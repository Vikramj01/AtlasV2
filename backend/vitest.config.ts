import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    // journeySimulator's landing-step consent-banner settle wait (2-3.5s,
    // real setTimeout — see services/detection/consentBanner.ts) stacks with
    // this suite's other already-real step-action waits; the 5s default
    // starts clipping tests that hit both. See pipeline.test.ts.
    testTimeout: 15000,
    include: [
      'src/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      '../audit/tests/**/*.{test,spec}.?(c|m)[jt]s?(x)',
    ],
    env: {
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_ANON_KEY: 'test-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      REDIS_URL: 'redis://localhost:6379',
      BROWSERBASE_API_KEY: 'test-browserbase-key',
      BROWSERBASE_PROJECT_ID: 'test-project-id',
      ANTHROPIC_API_KEY: 'test-anthropic-key',
      NODE_ENV: 'test',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
