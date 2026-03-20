/**
 * Stress ramp test — find the breaking point.
 *
 * Ramps concurrent users from 1 → 200 over 10 minutes against read-only endpoints.
 * Watch for p99 latency spikes, error rate increases, and Render/Redis memory alerts.
 *
 * Safe to run against production (read-only: list + poll endpoints, no job starts).
 *
 * Usage:
 *   BASE_URL=https://your-backend.onrender.com \
 *   AUTH_TOKEN=eyJ... \
 *   AUDIT_ID=some-completed-audit-id \
 *   k6 run load-tests/stress-ramp.js
 *
 * Watch alongside:
 *   - Render dashboard → CPU + memory graphs
 *   - Supabase dashboard → active connections, slow queries
 *   - Redis → used_memory, connected_clients (via redis-cli INFO)
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

export const options = {
  stages: [
    { duration: '1m',  target: 10  },  // warm-up
    { duration: '2m',  target: 50  },  // moderate load
    { duration: '2m',  target: 100 },  // heavy load
    { duration: '2m',  target: 150 },  // near-stress
    { duration: '2m',  target: 200 },  // stress
    { duration: '1m',  target: 0   },  // cool-down
  ],
  thresholds: {
    http_req_duration:           ['p(95)<500', 'p(99)<1000'],
    http_req_failed:             ['rate<0.05'],   // <5% errors allowed under stress
    'list_audits_duration':      ['p(95)<300'],
    'poll_audit_duration':       ['p(95)<200'],
    'list_sessions_duration':    ['p(95)<300'],
  },
};

const BASE_URL = __ENV.BASE_URL  || 'http://localhost:3001';
const TOKEN    = __ENV.AUTH_TOKEN;
const AUDIT_ID = __ENV.AUDIT_ID  || 'replace-with-a-real-audit-id';

const headers = { Authorization: `Bearer ${TOKEN}` };

const listAuditsDuration   = new Trend('list_audits_duration');
const pollAuditDuration    = new Trend('poll_audit_duration');
const listSessionsDuration = new Trend('list_sessions_duration');
const errorRate            = new Rate('errors');

export default function () {
  // Rotate between the three most frequent read paths
  const roll = Math.random();

  if (roll < 0.4) {
    // 40% — audit status poll (frontend polls every 2s per active user)
    const start = Date.now();
    const r = http.get(`${BASE_URL}/api/audits/${AUDIT_ID}`, { headers });
    pollAuditDuration.add(Date.now() - start);
    const ok = check(r, { 'poll 200': (r) => r.status === 200 });
    errorRate.add(!ok);

  } else if (roll < 0.7) {
    // 30% — dashboard list (every time user opens /dashboard)
    const start = Date.now();
    const r = http.get(`${BASE_URL}/api/audits`, { headers });
    listAuditsDuration.add(Date.now() - start);
    const ok = check(r, { 'list 200': (r) => r.status === 200 });
    errorRate.add(!ok);

  } else {
    // 30% — planning sessions list
    const start = Date.now();
    const r = http.get(`${BASE_URL}/api/planning/sessions`, { headers });
    listSessionsDuration.add(Date.now() - start);
    const ok = check(r, { 'sessions 200': (r) => r.status === 200 });
    errorRate.add(!ok);
  }

  // Simulate realistic think time between requests
  sleep(Math.random() * 2 + 0.5); // 0.5–2.5s
}
