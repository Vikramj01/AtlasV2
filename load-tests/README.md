# Atlas Load Tests (k6)

All scripts use [k6](https://k6.io). Install once:

```bash
# macOS
brew install k6

# Linux
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6
```

## Running tests

All scripts read `BASE_URL` and `AUTH_TOKEN` from environment:

```bash
export BASE_URL=https://your-backend.onrender.com
export AUTH_TOKEN=eyJhbGci...    # Supabase JWT for a test user

# Smoke test (quick sanity — ~30s, 1 VU)
k6 run load-tests/smoke.js

# Polling load test (most realistic — simulates active users)
k6 run load-tests/poll-load.js

# Audit start burst (tests queue backpressure)
k6 run load-tests/audit-burst.js

# Full stress ramp (find the breaking point)
k6 run load-tests/stress-ramp.js

# Run against local backend
BASE_URL=http://localhost:3001 k6 run load-tests/smoke.js
```

## Test accounts

Use dedicated load-test accounts (Agency plan) to bypass rate limits.
Never use real user accounts — load tests will exhaust their monthly quota.

## Thresholds (pass/fail targets)

| Metric | Target |
|--------|--------|
| `http_req_duration` p95 | < 200ms for GET endpoints |
| `http_req_duration` p99 | < 500ms under 100 VUs |
| `http_req_failed` rate | < 0.1% |
| Queue drain time | < 60s for 10 queued audits |
