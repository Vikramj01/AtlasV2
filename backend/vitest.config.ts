import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    include: [
      'src/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      '../audit/tests/**/*.{test,spec}.?(c|m)[jt]s?(x)',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
      exclude: [
        'src/index.ts',
        'src/app.ts',
        'src/**/*.d.ts',
        'src/**/types.ts',
        'src/**/types/*.ts',
      ],
    },
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
