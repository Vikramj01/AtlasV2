import { supabaseAdmin } from '@/services/database/supabase';
import { resolveTokens, refreshGoogleToken } from '@/services/connections/tokenManager';
import { env } from '@/config/env';
import logger from '@/utils/logger';
import type {
  DMAIngestEventsRequest,
  DMAIngestEventsResponse,
  DMAIngestAudienceMembersRequest,
  DMAIngestAudienceMembersResponse,
  DMAApiError,
} from './dmaTypes';

const DMA_BASE_URL = 'https://datamanager.googleapis.com/v1';
const PROACTIVE_REFRESH_WINDOW_MS = 5 * 60 * 1000; // refresh if < 5 min to expiry

export class DMAClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly apiError?: DMAApiError,
  ) {
    super(message);
    this.name = 'DMAClientError';
  }
}

interface DMACredRow {
  linked_connection_id: string | null;
}

async function resolveLinkedConnectionId(orgId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('google_dma_credentials')
    .select('linked_connection_id')
    .eq('org_id', orgId)
    .maybeSingle();

  if (error) throw new DMAClientError(`DMA credential lookup failed: ${error.message}`, 500);

  const row = data as DMACredRow | null;
  if (!row?.linked_connection_id) {
    throw new DMAClientError(
      `No DMA OAuth connection for org ${orgId}. Reconnect Google Ads to grant Data Manager scope.`,
      401,
    );
  }

  return row.linked_connection_id;
}

async function getAccessToken(orgId: string): Promise<string> {
  const connectionId = await resolveLinkedConnectionId(orgId);
  const tokens = await resolveTokens(connectionId);

  if (tokens.expires_at < Date.now() + PROACTIVE_REFRESH_WINDOW_MS) {
    const refreshed = await refreshGoogleToken(connectionId);
    return refreshed.access_token;
  }

  return tokens.access_token;
}

function buildHeaders(accessToken: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
  // Same developer token used for Google Ads API; DMA is part of the same ecosystem
  const devToken = env.GOOGLE_DMA_DEVELOPER_TOKEN || env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (devToken) headers['developer-token'] = devToken;
  return headers;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new DMAClientError(
      `DMA API returned non-JSON (${response.status}): ${text.slice(0, 200)}`,
      response.status,
    );
  }

  if (!response.ok) {
    const apiError = (parsed as { error?: DMAApiError }).error;
    throw new DMAClientError(
      apiError?.message ?? `DMA API error (${response.status})`,
      response.status,
      apiError,
    );
  }

  return parsed as T;
}

async function post<T>(orgId: string, path: string, body: unknown): Promise<T> {
  const accessToken = await getAccessToken(orgId);
  const url = `${DMA_BASE_URL}${path}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(accessToken),
    body: JSON.stringify(body),
  });

  if (response.status !== 401) {
    return parseResponse<T>(response);
  }

  // 401 — force-refresh and retry once
  logger.warn({ orgId, path }, 'DMA: 401 received, forcing token refresh');
  const connectionId = await resolveLinkedConnectionId(orgId);
  const refreshed = await refreshGoogleToken(connectionId);

  const retryResponse = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(refreshed.access_token),
    body: JSON.stringify(body),
  });

  return parseResponse<T>(retryResponse);
}

export async function ingestEvents(
  orgId: string,
  request: DMAIngestEventsRequest,
): Promise<DMAIngestEventsResponse> {
  logger.info(
    { orgId, eventCount: request.events.length, destinations: request.destinations.map((d) => d.type) },
    'DMA: ingestEvents',
  );
  return post<DMAIngestEventsResponse>(orgId, '/events:ingest', request);
}

// Runs validateOnly=true against events:ingest; does not write any data.
export async function validateEvents(
  orgId: string,
  request: Omit<DMAIngestEventsRequest, 'validateOnly'>,
): Promise<DMAIngestEventsResponse> {
  return post<DMAIngestEventsResponse>(orgId, '/events:ingest', {
    ...request,
    validateOnly: true,
  });
}

export async function ingestAudienceMembers(
  orgId: string,
  request: DMAIngestAudienceMembersRequest,
): Promise<DMAIngestAudienceMembersResponse> {
  logger.info(
    { orgId, memberCount: request.audienceMembers.length, destinations: request.destinations.map((d) => d.type) },
    'DMA: ingestAudienceMembers',
  );
  return post<DMAIngestAudienceMembersResponse>(orgId, '/audiencemembers:ingest', request);
}
