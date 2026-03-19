/**
 * Smoke test — 1 VU, ~30 seconds.
 * Verifies every key endpoint is reachable and returns expected status codes
 * before running heavier tests. Run this first after any deployment.
 *
 * Usage:
 *   BASE_URL=https://your-backend.onrender.com AUTH_TOKEN=eyJ... k6 run load-tests/smoke.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 1,
  duration: '30s',
  thresholds: {
    http_req_failed: ['rate<0.01'],          // 0 failures tolerated in smoke
    http_req_duration: ['p(95)<1000'],       // 1s max for any single request
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
const TOKEN    = __ENV.AUTH_TOKEN;

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
};

export default function () {
  // Health check (public — no auth needed)
  {
    const r = http.get(`${BASE_URL}/health`);
    check(r, { 'health 200': (r) => r.status === 200 });
  }

  sleep(0.5);

  // List audits
  {
    const r = http.get(`${BASE_URL}/api/audits`, { headers });
    check(r, {
      'audits list 200': (r) => r.status === 200,
      'audits list is array': (r) => Array.isArray(JSON.parse(r.body)),
    });
  }

  sleep(0.5);

  // List planning sessions
  {
    const r = http.get(`${BASE_URL}/api/planning/sessions`, { headers });
    check(r, {
      'planning sessions 200': (r) => r.status === 200,
      'planning sessions has data key': (r) => JSON.parse(r.body).data !== undefined,
    });
  }

  sleep(0.5);

  // List journeys
  {
    const r = http.get(`${BASE_URL}/api/journeys`, { headers });
    check(r, { 'journeys 200': (r) => r.status === 200 });
  }

  sleep(1);
}
