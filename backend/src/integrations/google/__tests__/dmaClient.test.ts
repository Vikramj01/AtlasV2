import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DMAClientError, ingestEvents, validateEvents, ingestAudienceMembers, removeAudienceMembers } from '../dmaClient';
import type { DMAIngestEventsRequest, DMAIngestAudienceMembersRequest, DMARemoveAudienceMembersRequest } from '../dmaTypes';

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

const GOOGLE_ADS_DESTINATION = {
  operatingAccount: { accountId: '1234567890', accountType: 'GOOGLE_ADS' as const },
  productDestinationId: '999',
};

const MINIMAL_EVENTS_REQUEST: DMAIngestEventsRequest = {
  events: [{
    eventTimestamp: '2026-05-20T10:00:00Z',
    eventSource: 'WEB',
    userData: { userIdentifiers: [{ emailAddress: 'abc123' }] },
  }],
  destinations: [GOOGLE_ADS_DESTINATION],
};

const MINIMAL_AUDIENCE_REQUEST: DMAIngestAudienceMembersRequest = {
  audienceMembers: [{ userData: { userIdentifiers: [{ emailAddress: 'abc123' }] } }],
  destinations: [{ operatingAccount: { accountId: '1234567890', accountType: 'GOOGLE_ADS' } }],
};

const MINIMAL_REMOVE_REQUEST: DMARemoveAudienceMembersRequest = {
  audienceMembers: [{ userData: { userIdentifiers: [{ emailAddress: 'abc123' }] } }],
  destinations: [{ operatingAccount: { accountId: '1234567890', accountType: 'GOOGLE_ADS' } }],
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
    const fetchSpy = mockFetch(200, { requestId: 'req-1' });

    await ingestEvents(ORG_ID, MINIMAL_EVENTS_REQUEST);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://datamanager.googleapis.com/v1/events:ingest');
    expect((init?.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect((init?.headers as Record<string, string>)['developer-token']).toBe('test-dev-token');
  });

  it('sends the request body with the corrected Event shape (eventTimestamp, nested userData)', async () => {
    const fetchSpy = mockFetch(200, { requestId: 'req-1' });

    await ingestEvents(ORG_ID, MINIMAL_EVENTS_REQUEST);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.events[0].eventTimestamp).toBe('2026-05-20T10:00:00Z');
    expect(body.events[0].userData.userIdentifiers[0].emailAddress).toBe('abc123');
    expect(body.destinations[0].operatingAccount.accountType).toBe('GOOGLE_ADS');
    expect(body.destinations[0].productDestinationId).toBe('999');
  });

  it('returns the parsed response body', async () => {
    const expectedResponse = { requestId: 'req-abc' };
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
      .mockResolvedValueOnce({ status: 200, ok: true, text: async () => '{"requestId":"req-1"}' } as Response);

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
    const fetchSpy = mockFetch(200, { requestId: 'req-1' });

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
    const fetchSpy = mockFetch(200, { requestId: 'req-1' });

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

  it('calls audienceMembers:ingest with the correctly-cased URL', async () => {
    const fetchSpy = mockFetch(200, { requestId: 'req-1' });

    await ingestAudienceMembers(ORG_ID, MINIMAL_AUDIENCE_REQUEST);

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://datamanager.googleapis.com/v1/audienceMembers:ingest');
  });

  it('sends the request body with the corrected AudienceMember shape (nested userData)', async () => {
    const fetchSpy = mockFetch(200, { requestId: 'req-1' });

    await ingestAudienceMembers(ORG_ID, MINIMAL_AUDIENCE_REQUEST);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.audienceMembers[0].userData.userIdentifiers[0].emailAddress).toBe('abc123');
    // The live API has no operationType field at all — CREATE and REMOVE are
    // separate methods (see removeAudienceMembers below), not a body flag.
    expect(body.operationType).toBeUndefined();
  });

  it('returns parsed response', async () => {
    const expected = { requestId: 'req-xyz' };
    mockFetch(200, expected);

    const result = await ingestAudienceMembers(ORG_ID, MINIMAL_AUDIENCE_REQUEST);
    expect(result).toEqual(expected);
  });
});

describe('removeAudienceMembers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDmaCredentials();
    mockTokens();
  });

  it('calls audienceMembers:remove — a distinct method from :ingest', async () => {
    const fetchSpy = mockFetch(200, { requestId: 'req-1' });

    await removeAudienceMembers(ORG_ID, MINIMAL_REMOVE_REQUEST);

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://datamanager.googleapis.com/v1/audienceMembers:remove');
  });

  it('returns parsed response', async () => {
    const expected = { requestId: 'req-remove-1' };
    mockFetch(200, expected);

    const result = await removeAudienceMembers(ORG_ID, MINIMAL_REMOVE_REQUEST);
    expect(result).toEqual(expected);
  });

  it('throws DMAClientError on non-2xx response', async () => {
    mockFetch(400, { error: { code: 400, message: 'Invalid request', status: 'INVALID_ARGUMENT' } });

    await expect(removeAudienceMembers(ORG_ID, MINIMAL_REMOVE_REQUEST)).rejects.toThrow(DMAClientError);
  });
});
