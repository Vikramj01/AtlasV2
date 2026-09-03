/**
 * Unit tests for the GA4 client_id / session-start helpers used by
 * Cross-Domain Continuity (L4.3/L4.4).
 */
import { describe, it, expect } from 'vitest';
import { extractGa4ClientId, ga4SessionStartDetected, detectMetaConversionEvent, detectTikTokConversionEvent } from '../trackingSignals';
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

describe('detectMetaConversionEvent', () => {
  it('detects a tracked event via the ev query param', () => {
    const requests = [makeRequest({ url: 'https://www.facebook.com/tr?id=123&ev=Purchase' })];
    expect(detectMetaConversionEvent(requests).hitCount).toBe(1);
  });

  it('detects a tracked event via the ev POST body param', () => {
    const requests = [makeRequest({ url: 'https://www.facebook.com/tr', method: 'POST', body: 'id=123&ev=Lead' })];
    expect(detectMetaConversionEvent(requests).hitCount).toBe(1);
  });

  it('does not count a base PageView pixel call as a conversion event', () => {
    const requests = [makeRequest({ url: 'https://www.facebook.com/tr?id=123&ev=PageView' })];
    expect(detectMetaConversionEvent(requests).hitCount).toBe(0);
  });

  it('ignores requests with no ev param at all', () => {
    const requests = [makeRequest({ url: 'https://www.facebook.com/tr?id=123' })];
    expect(detectMetaConversionEvent(requests).hitCount).toBe(0);
  });
});

describe('detectTikTokConversionEvent', () => {
  it('counts a POST to the TikTok tracking endpoint as an event', () => {
    const requests = [makeRequest({ url: 'https://analytics.tiktok.com/api/v2/pixel/track', method: 'POST' })];
    expect(detectTikTokConversionEvent(requests).hitCount).toBe(1);
  });

  it('does not count the GET pixel loader script as an event', () => {
    const requests = [makeRequest({ url: 'https://analytics.tiktok.com/i18n/pixel/events.js', method: 'GET' })];
    expect(detectTikTokConversionEvent(requests).hitCount).toBe(0);
  });
});
