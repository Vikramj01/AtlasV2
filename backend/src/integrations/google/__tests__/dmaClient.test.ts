import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DMAClientError, ingestEvents, validateEvents, ingestAudienceMembers } from '../dmaClient';
import type { DMAIngestEventsRequest, DMAIngestAudienceMembersRequest } from '../dmaTypes';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/services/database/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

vi.mock('@/services/connections/tokenManager', () => ({
  resolveTokens: vi.fn(),
  refreshGoogleToken: vi.fn(),
}));

vi.mock('@/config/env', () => ({
  env: {
    GOOGLE_DMA_DEVELOPER_TOKEN: 'test-dev-token',
    GOOGLE_ADS_DEVELOPER_TOKEN: '',
  },
}));

vi.mock('@/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { supabaseAdmin } from '@/services/database/supabase';
import { resolveTokens, refreshGoogleToken } from '@/services/connections/tokenManager';

// ── Helpers ───────────────────────────────────────────────────────────────────

const ORG_ID = 'org-123';
const CONNECTION_ID = 'conn-456';
const ACCESS_TOKEN = 'ya29.test-access-token';
const FUTURE_EXPIRY = Date.now() + 60 * 60 * 1000; // 1 hour from now

function mockDmaCredentials(linkedConnectionId: string | null = CONNECTION_ID) {
  const mockFrom = vi.mocked(supabaseAdmin.from);
  mockFrom.mockReturnValue({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: linkedConnectionId ? { linked_connection_id: linkedConnectionId } : null,
      error: null,
    }),
  } as unknown as ReturnType<typeof supabaseAdmin.from>);
}

function mockTokens(accessToken = ACCESS_TOKEN, expiresAt = FUTURE_EXPIRY) {
  vi.mocked(resolveTokens).mockResolvedValue({
    access_token: accessToken,
    refresh_token: 'refresh-token',
    expires_at: expiresAt,
    token_type: 'Bearer',
  });
}

function mockFetch(status: number, body: unknown) {
  return vi.spyOn(global, 'fetch').mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    text: async () => JSON.stringify(body),
  } as Response);
}

const MINIMAL_EVENTS_REQUEST: DMAIngestEventsRequest = {
  events: [{
    eventType: 'CONVERSION',
    eventDateTime: '2026-05-20T10:00:00Z',
    eventSource: 'WEB',
    userIdentifiers: [{ hashedEmail: 'abc123' }],
  }],
  destinations: [{ type: 'GOOGLE_ADS', customerId: '1234567890' }],
};

const MINIMAL_AUDIENCE_REQUEST: DMAIngestAudienceMembersRequest = {
  audienceMembers: [{ hashedEmail: 'abc123' }],
  destinations: [{ type: 'GOOGLE_ADS', customerId: '1234567890' }],
  operationType: 'CREATE',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DMAClientError', () => {
  it('sets name, message, status, and apiError', () => {
    const err = new DMAClientError('test error', 422, { code: 422, message: 'bad', status: 'INVALID' });
    expect(err.name).toBe('DMAClientError');
    expect(err.message).toBe('test error');
    expect(err.status).toBe(422);
    expect(err.apiError?.code).toBe(422);
  });

  it('works without apiError', () => {
    const err = new DMAClientError('no creds', 401);
    expect(err.apiError).toBeUndefined();
  });
});

describe('ingestEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDmaCredentials();
    mockTokens();
  });

  it('calls events:ingest with correct URL and Authorization header', async () => {
    const fetchSpy = mockFetch(200, { eventResults: [] });

    await ingestEvents(ORG_ID, MINIMAL_EVENTS_REQUEST);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://datamanager.googleapis.com/v1/events:ingest');
    expect((init?.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect((init?.headers as Record<string, string>)['developer-token']).toBe('test-dev-token');
  });

  it('returns the parsed response body', async () => {
    const expectedResponse = { eventResults: [{ eventIndex: 0 }] };
    mockFetch(200, expectedResponse);

    const result = await ingestEvents(ORG_ID, MINIMAL_EVENTS_REQUEST);
    expect(result).toEqual(expectedResponse);
  });

  it('throws DMAClientError on non-2xx response', async () => {
    mockFetch(400, { error: { code: 400, message: 'Invalid request', status: 'INVALID_ARGUMENT' } });

    await expect(ingestEvents(ORG_ID, MINIMAL_EVENTS_REQUEST)).rejects.toThrow(DMAClientError);
    await expect(ingestEvents(ORG_ID, MINIMAL_EVENTS_REQUEST)).rejects.toMatchObject({
      status: 400,
      apiError: { code: 400, status: 'INVALID_ARGUMENT' },
    });
  });

  it('refreshes token and retries on 401', async () => {
    const refreshedToken = 'ya29.refreshed-token';
    vi.mocked(refreshGoogleToken).mockResolvedValue({
      access_token: refreshedToken,
      refresh_token: 'refresh-token',
      expires_at: FUTURE_EXPIRY,
      token_type: 'Bearer',
    });

    const fetchSpy = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ status: 401, ok: false, text: async () => '{"error":{"code":401,"message":"Unauthorized","status":"UNAUTHENTICATED"}}' } as Response)
      .mockResolvedValueOnce({ status: 200, ok: true, text: async () => '{"eventResults":[]}' } as Response);

    await ingestEvents(ORG_ID, MINIMAL_EVENTS_REQUEST);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(refreshGoogleToken).toHaveBeenCalledWith(CONNECTION_ID);
    // Retry uses refreshed token
    const [, retryInit] = fetchSpy.mock.calls[1];
    expect((retryInit?.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${refreshedToken}`);
  });

  it('proactively refreshes if token expires within 5 minutes', async () => {
    const nearExpiryTokens = { access_token: 'old-token', refresh_token: 'rt', expires_at: Date.now() + 60_000, token_type: 'Bearer' };
    const refreshedTokens = { access_token: 'fresh-token', refresh_token: 'rt', expires_at: FUTURE_EXPIRY, token_type: 'Bearer' };
    vi.mocked(resolveTokens).mockResolvedValue(nearExpiryTokens);
    vi.mocked(refreshGoogleToken).mockResolvedValue(refreshedTokens);
    const fetchSpy = mockFetch(200, { eventResults: [] });

    await ingestEvents(ORG_ID, MINIMAL_EVENTS_REQUEST);

    expect(refreshGoogleToken).toHaveBeenCalledWith(CONNECTION_ID);
    const [, init] = fetchSpy.mock.calls[0];
    expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer fresh-token');
  });

  it('throws DMAClientError when no DMA credentials exist', async () => {
    mockDmaCredentials(null);

    await expect(ingestEvents(ORG_ID, MINIMAL_EVENTS_REQUEST)).rejects.toThrow(DMAClientError);
    await expect(ingestEvents(ORG_ID, MINIMAL_EVENTS_REQUEST)).rejects.toMatchObject({ status: 401 });
  });

  it('throws DMAClientError on non-JSON response body', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      status: 500,
      ok: false,
      text: async () => 'Internal Server Error',
    } as Response);

    await expect(ingestEvents(ORG_ID, MINIMAL_EVENTS_REQUEST)).rejects.toThrow(DMAClientError);
  });
});

describe('validateEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDmaCredentials();
    mockTokens();
  });

  it('adds validateOnly: true to the request body', async () => {
    const fetchSpy = mockFetch(200, { validatedEventCount: 1 });

    const { validateOnly: _v, ...requestWithoutFlag } = { ...MINIMAL_EVENTS_REQUEST, validateOnly: false };
    await validateEvents(ORG_ID, requestWithoutFlag);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.validateOnly).toBe(true);
  });
});

describe('ingestAudienceMembers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDmaCredentials();
    mockTokens();
  });

  it('calls audiencemembers:ingest with correct URL', async () => {
    const fetchSpy = mockFetch(200, { memberResults: [] });

    await ingestAudienceMembers(ORG_ID, MINIMAL_AUDIENCE_REQUEST);

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://datamanager.googleapis.com/v1/audiencemembers:ingest');
  });

  it('includes operationType in the request body', async () => {
    const fetchSpy = mockFetch(200, { memberResults: [] });

    await ingestAudienceMembers(ORG_ID, MINIMAL_AUDIENCE_REQUEST);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.operationType).toBe('CREATE');
  });

  it('returns parsed response', async () => {
    const expected = { memberResults: [{ memberIndex: 0 }] };
    mockFetch(200, expected);

    const result = await ingestAudienceMembers(ORG_ID, MINIMAL_AUDIENCE_REQUEST);
    expect(result).toEqual(expected);
  });
});
