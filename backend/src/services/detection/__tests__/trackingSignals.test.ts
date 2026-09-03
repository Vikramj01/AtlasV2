/**
 * Unit tests for the GA4 client_id / session-start helpers used by
 * Cross-Domain Continuity (L4.3/L4.4).
 */
import { describe, it, expect } from 'vitest';
import { extractGa4ClientId, ga4SessionStartDetected } from '../trackingSignals';
import type { NetworkRequest } from '@/types/audit';

function makeRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    url: 'https://www.google-analytics.com/g/collect',
    method: 'GET',
    headers: {},
    timestamp: Date.now(),
    step: 'landing',
    ...overrides,
  };
}

describe('extractGa4ClientId', () => {
  it('reads cid from a GA4 collect request query string', () => {
    const requests = [makeRequest({ url: 'https://www.google-analytics.com/g/collect?tid=G-ABC&cid=123456789.987654321' })];
    expect(extractGa4ClientId(requests)).toBe('123456789.987654321');
  });

  it('reads cid from a GA4 collect request POST body', () => {
    const requests = [makeRequest({ url: 'https://www.google-analytics.com/g/collect', method: 'POST', body: 'tid=G-ABC&cid=111.222' })];
    expect(extractGa4ClientId(requests)).toBe('111.222');
  });

  it('falls back to the _ga cookie when no request has a cid', () => {
    const cookies = { _ga: 'GA1.1.123456789.987654321' };
    expect(extractGa4ClientId([], cookies)).toBe('123456789.987654321');
  });

  it('returns undefined when neither a request nor a usable cookie is present', () => {
    expect(extractGa4ClientId([], {})).toBeUndefined();
    expect(extractGa4ClientId([], { _ga: 'malformed' })).toBeUndefined();
  });

  it('ignores non-GA4 requests', () => {
    const requests = [makeRequest({ url: 'https://www.facebook.com/tr?id=123' })];
    expect(extractGa4ClientId(requests, { _ga: 'GA1.1.1.2' })).toBe('1.2');
  });
});

describe('ga4SessionStartDetected', () => {
  it('detects a session_start hit via _ss=1', () => {
    const requests = [makeRequest({ url: 'https://www.google-analytics.com/g/collect?tid=G-ABC&_ss=1' })];
    expect(ga4SessionStartDetected(requests)).toBe(true);
  });

  it('returns false when no hit carries _ss=1', () => {
    const requests = [makeRequest({ url: 'https://www.google-analytics.com/g/collect?tid=G-ABC' })];
    expect(ga4SessionStartDetected(requests)).toBe(false);
  });

  it('returns false for an empty request list', () => {
    expect(ga4SessionStartDetected([])).toBe(false);
  });
});
