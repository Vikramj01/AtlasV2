/**
 * Audit burst test — tests queue backpressure and worker concurrency.
 *
 * Fires N audit start requests in quick succession, then polls until all complete.
 * Use this to verify:
 *   1. The queue doesn't drop jobs under burst load
 *   2. Worker concurrency (AUDIT_WORKER_CONCURRENCY) is actually parallelising jobs
 *   3. The POST /start endpoint stays fast (it should return immediately — it only enqueues)
 *
 * IMPORTANT: This test starts REAL audits against a real URL. Use a staging
 * backend with mock Browserbase (or a test URL that resolves quickly).
 * Each audit counts toward the user's monthly quota — use an Agency test account.
 *
 * Usage:
 *   BASE_URL=https://staging-backend.onrender.com \
 *   AUTH_TOKEN=eyJ... \
 *   BURST_SIZE=5 \
 *   k6 run load-tests/audit-burst.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';

const BURST_SIZE = parseInt(__ENV.BURST_SIZE || '5');

export const options = {
  // One iteration = one burst of BURST_SIZE starts, then poll-to-completion
  scenarios: {
    burst: {
      executor: 'shared-iterations',
      vus: BURST_SIZE,
      iterations: BURST_SIZE,
      maxDuration: '10m',
    },
  },
  thresholds: {
    // The POST /start should return in under 2s (just enqueue, no blocking work)
    'http_req_duration{endpoint:start}': ['p(95)<2000'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
const TOKEN    = __ENV.AUTH_TOKEN;

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
};

// Minimal audit payload — use a fast-loading page in staging
const auditPayload = JSON.stringify({
  website_url: __ENV.TEST_URL || 'https://example.com',
  funnel_type: 'ecommerce',
  region: 'US',
  url_map: {
    home:         __ENV.TEST_URL || 'https://example.com',
    product:      __ENV.TEST_URL || 'https://example.com',
    cart:         __ENV.TEST_URL || 'https://example.com',
    checkout:     __ENV.TEST_URL || 'https://example.com',
    confirmation: __ENV.TEST_URL || 'https://example.com',
  },
});

export default function () {
  // Step 1: Start the audit (should be near-instant — just enqueues)
  const startRes = http.post(`${BASE_URL}/api/audits/start`, auditPayload, {
    headers,
    tags: { endpoint: 'start' },
  });

  const startOk = check(startRes, {
    'start 200': (r) => r.status === 200,
    'has audit_id': (r) => {
      try { return !!JSON.parse(r.body).audit_id; } catch { return false; }
    },
  });

  if (!startOk) return;

  const auditId = JSON.parse(startRes.body).audit_id;

  // Step 2: Poll until completed or failed (max ~8 minutes for a real audit)
  const MAX_POLLS = 240; // 240 × 2s = 8 min
  for (let i = 0; i < MAX_POLLS; i++) {
    sleep(2);
    const pollRes = http.get(`${BASE_URL}/api/audits/${auditId}`, {
      headers,
      tags: { endpoint: 'poll' },
    });

    check(pollRes, { 'poll 200': (r) => r.status === 200 });

    let body;
    try { body = JSON.parse(pollRes.body); } catch { break; }

    if (body.status === 'completed' || body.status === 'failed') {
      check(pollRes, {
        'audit completed (not failed)': () => body.status === 'completed',
      });
      break;
    }
  }
}
