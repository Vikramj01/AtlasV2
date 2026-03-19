/**
 * Polling load test — simulates real users actively watching audit/planning progress.
 *
 * In production, every active user polls GET /api/audits/:id every 2 seconds
 * until status === 'completed'. This is the highest-frequency call pattern.
 *
 * Scenario: 50 concurrent "users" each polling an audit status for 3 minutes.
 *
 * Usage:
 *   BASE_URL=https://your-backend.onrender.com \
 *   AUTH_TOKEN=eyJ... \
 *   AUDIT_ID=some-real-audit-uuid \
 *   k6 run load-tests/poll-load.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

export const options = {
  scenarios: {
    audit_pollers: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 25 },   // ramp up to 25 pollers
        { duration: '2m',  target: 50 },   // ramp to 50 (peak)
        { duration: '30s', target: 0 },    // wind down
      ],
    },
    session_pollers: {
      executor: 'constant-vus',
      vus: 20,                             // 20 users watching planning sessions
      duration: '3m',
      startTime: '15s',                    // start slightly after audit pollers
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<200', 'p(99)<500'],
    http_req_failed: ['rate<0.001'],       // < 0.1% errors
    'audit_poll_duration': ['p(95)<150'],  // audit status GET should be fast (DB read only)
  },
};

const BASE_URL  = __ENV.BASE_URL  || 'http://localhost:3001';
const TOKEN     = __ENV.AUTH_TOKEN;
const AUDIT_ID  = __ENV.AUDIT_ID  || 'replace-with-a-real-completed-audit-id';

const headers = { Authorization: `Bearer ${TOKEN}` };

const auditPollDuration  = new Trend('audit_poll_duration');
const sessionPollDuration = new Trend('session_poll_duration');
const errorRate = new Rate('errors');

export function auditPollers() {
  const start = Date.now();
  const r = http.get(`${BASE_URL}/api/audits/${AUDIT_ID}`, { headers });
  auditPollDuration.add(Date.now() - start);

  const ok = check(r, {
    'audit poll 200': (r) => r.status === 200,
    'audit has status': (r) => {
      try { return !!JSON.parse(r.body).status; } catch { return false; }
    },
  });
  errorRate.add(!ok);

  sleep(2); // match the real frontend poll interval
}

export function sessionPollers() {
  // You need at least one real planning session ID for this
  const SESSION_ID = __ENV.SESSION_ID || 'replace-with-a-real-session-id';
  const start = Date.now();
  const r = http.get(`${BASE_URL}/api/planning/sessions/${SESSION_ID}`, { headers });
  sessionPollDuration.add(Date.now() - start);

  check(r, { 'session poll 200 or 404': (r) => r.status === 200 || r.status === 404 });

  sleep(2);
}

// k6 scenario → function mapping
export default auditPollers;
