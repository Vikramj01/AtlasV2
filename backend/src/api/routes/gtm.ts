/**
 * GTM Container Ingestion — /api/gtm
 *
 * POST /api/gtm/connect              — initiate GTM OAuth (returns authUrl)
 * GET  /api/gtm/callback             — OAuth callback; exchanges code, stores tokens
 * POST /api/gtm/upload               — manual container JSON upload
 * GET  /api/gtm/containers           — list connected containers for this org
 * DELETE /api/gtm/containers/:id     — disconnect a container (wipes credentials)
 *
 * All routes require authMiddleware + planGuard('pro').
 * The callback route additionally accepts state as a query param (browser redirect).
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { createHmac, randomBytes } from 'crypto';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authMiddleware';
import { planGuard } from '../middleware/planGuard';
import { sendInternalError } from '@/utils/apiError';
import { supabaseAdmin } from '@/services/database/supabase';
import { env } from '@/config/env';
import { encryptGtmCredentials, decryptGtmCredentials } from '@/services/gtm/gtmCredentials';
import { parseContainerJson, validateContainerJsonShape } from '@/services/gtm/containerParser';
import { gtmContainerSyncQueue } from '@/services/queue/jobQueue';
import logger from '@/utils/logger';

export const gtmRouter = Router();
gtmRouter.use(authMiddleware, planGuard('pro'));

// ── Constants ─────────────────────────────────────────────────────────────────

const GTM_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GTM_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GTM_SCOPE = 'https://www.googleapis.com/auth/tagmanager.readonly';

function buildRedirectUri(): string {
  return `${env.FRONTEND_URL.replace(/\/$/, '')}/settings/implementation-health/gtm/callback`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function resolveOrgId(userId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('organization_id')
    .eq('id', userId)
    .single();
  return (data as { organization_id: string } | null)?.organization_id ?? userId;
}

function generateState(orgId: string): string {
  const nonce = randomBytes(16).toString('hex');
  const ts = Date.now().toString();
  const payload = `${nonce}:${orgId}:${ts}`;
  const hmac = createHmac('sha256', env.OAUTH_STATE_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}:${hmac}`).toString('base64url');
}

function verifyState(state: string): { orgId: string } {
  let decoded: string;
  try {
    decoded = Buffer.from(state, 'base64url').toString('utf8');
  } catch {
    throw new Error('Invalid OAuth state encoding');
  }
  const parts = decoded.split(':');
  if (parts.length !== 4) throw new Error('Invalid OAuth state format');

  const [nonce, orgId, ts, receivedHmac] = parts;
  const payload = `${nonce}:${orgId}:${ts}`;
  const expectedHmac = createHmac('sha256', env.OAUTH_STATE_SECRET).update(payload).digest('hex');
  if (expectedHmac !== receivedHmac) throw new Error('OAuth state HMAC verification failed');

  const age = Date.now() - parseInt(ts, 10);
  if (age > 10 * 60 * 1000) throw new Error('OAuth state expired (>10 min)');

  return { orgId };
}

// ── Zod schemas ───────────────────────────────────────────────────────────────

const connectSchema = z.object({
  client_id: z.string().uuid().optional(),
  property_id: z.string().uuid(),
});

const callbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
  container_id: z.string().min(1),
  account_id: z.string().optional(),
});

const uploadSchema = z.object({
  property_id: z.string().uuid(),
  client_id: z.string().uuid().optional(),
  container_json: z.record(z.unknown()),
});

// ── POST /api/gtm/connect ─────────────────────────────────────────────────────
// Returns the Google OAuth URL the frontend should redirect the user to.

gtmRouter.post('/connect', async (req: Request, res: Response): Promise<void> => {
  const parse = connectSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid request', details: parse.error.flatten() });
    return;
  }

  try {
    const orgId = await resolveOrgId(req.user.id);
    const state = generateState(orgId);

    const params = new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      redirect_uri: buildRedirectUri(),
      response_type: 'code',
      scope: GTM_SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      state,
    });

    res.json({
      data: {
        auth_url: `${GTM_AUTH_URL}?${params.toString()}`,
        state,
        property_id: parse.data.property_id,
        client_id: parse.data.client_id ?? null,
      },
    });
  } catch (err) {
    sendInternalError(res, err, 'POST /api/gtm/connect');
  }
});

// ── GET /api/gtm/callback ─────────────────────────────────────────────────────
// Called by the frontend after Google redirects back with code + state.
// Exchanges the code for tokens, stores them encrypted, queues initial sync.

gtmRouter.get('/callback', async (req: Request, res: Response): Promise<void> => {
  const parse = callbackSchema.safeParse(req.query);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid callback params', details: parse.error.flatten() });
    return;
  }

  const { code, state, container_id, account_id } = parse.data;

  try {
    const { orgId } = verifyState(state);

    // Exchange code for tokens
    const tokenResponse = await fetch(GTM_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_OAUTH_CLIENT_ID,
        client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
        redirect_uri: buildRedirectUri(),
        grant_type: 'authorization_code',
      }).toString(),
    });

    if (!tokenResponse.ok) {
      const body = await tokenResponse.text();
      logger.error({ status: tokenResponse.status, body }, 'GTM OAuth token exchange failed');
      res.status(400).json({ error: 'OAuth token exchange failed' });
      return;
    }

    const tokens = await tokenResponse.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope: string;
    };

    if (!tokens.refresh_token) {
      res.status(400).json({ error: 'No refresh_token returned. Ensure prompt=consent is set.' });
      return;
    }

    const encrypted = encryptGtmCredentials({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + tokens.expires_in * 1000,
      scope: tokens.scope,
    });

    // Resolve property_id from req.user context — stored in session via state
    // For now accept property_id from query (passed through the state flow in the frontend)
    const property_id = req.query['property_id'] as string | undefined;
    const client_id = req.query['client_id'] as string | undefined;

    const { data: connection, error: insertErr } = await supabaseAdmin
      .from('gtm_container_connections')
      .insert({
        organization_id: orgId,
        client_id: client_id ?? null,
        property_id: property_id ?? orgId,
        container_id,
        account_id: account_id ?? null,
        auth_method: 'oauth',
        oauth_credentials_encrypted: encrypted,
      })
      .select('id')
      .single();

    if (insertErr || !connection) {
      throw new Error(`Failed to store GTM connection: ${insertErr?.message}`);
    }

    // Queue the initial container sync
    await gtmContainerSyncQueue.add({
      connection_id: connection.id,
      organization_id: orgId,
    });

    logger.info({ connectionId: connection.id, orgId }, 'GTM connection created, initial sync queued');

    res.json({
      data: { connection_id: connection.id, message: 'GTM connected. Initial sync queued.' },
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes('state')) {
      res.status(400).json({ error: err.message });
      return;
    }
    sendInternalError(res, err, 'GET /api/gtm/callback');
  }
});

// ── POST /api/gtm/upload ──────────────────────────────────────────────────────
// Manual container JSON upload. Validates schema, stores snapshot.

gtmRouter.post('/upload', async (req: Request, res: Response): Promise<void> => {
  const parse = uploadSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid request', details: parse.error.flatten() });
    return;
  }

  const { property_id, client_id, container_json } = parse.data;

  const validation = validateContainerJsonShape(container_json);
  if (!validation.valid) {
    res.status(400).json({ error: `Invalid GTM container JSON: ${validation.error}` });
    return;
  }

  try {
    const orgId = await resolveOrgId(req.user.id);
    const snapshot = parseContainerJson(container_json, 'manual_upload');

    // Upsert connection row for manual uploads (no credentials)
    const { data: connection, error: connErr } = await supabaseAdmin
      .from('gtm_container_connections')
      .upsert(
        {
          organization_id: orgId,
          client_id: client_id ?? null,
          property_id,
          container_id: snapshot.container_id,
          auth_method: 'manual_upload',
        },
        { onConflict: 'organization_id,property_id,container_id' },
      )
      .select('id')
      .single();

    if (connErr || !connection) {
      throw new Error(`Failed to upsert GTM connection: ${connErr?.message}`);
    }

    // Deactivate previous snapshots for this connection
    await supabaseAdmin
      .from('gtm_container_snapshots')
      .update({ is_active: false })
      .eq('connection_id', connection.id)
      .eq('is_active', true);

    const { data: snap, error: snapErr } = await supabaseAdmin
      .from('gtm_container_snapshots')
      .insert({
        connection_id: connection.id,
        organization_id: orgId,
        container_json,
        container_version: snapshot.container_id,
        is_active: true,
      })
      .select('id')
      .single();

    if (snapErr || !snap) {
      throw new Error(`Failed to store container snapshot: ${snapErr?.message}`);
    }

    await supabaseAdmin
      .from('gtm_container_connections')
      .update({
        last_synced_at: new Date().toISOString(),
        last_container_json_snapshot_id: snap.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', connection.id);

    // Queue IHC rules run against this snapshot
    await gtmContainerSyncQueue.add({
      connection_id: connection.id,
      organization_id: orgId,
      snapshot_id: snap.id,
      skip_fetch: true,
    });

    logger.info({ connectionId: connection.id, snapshotId: snap.id, orgId }, 'GTM container uploaded, IHC rules queued');

    res.status(201).json({
      data: {
        connection_id: connection.id,
        snapshot_id: snap.id,
        container_id: snapshot.container_id,
        tag_count: snapshot.tags.length,
        trigger_count: snapshot.triggers.length,
      },
    });
  } catch (err) {
    sendInternalError(res, err, 'POST /api/gtm/upload');
  }
});

// ── GET /api/gtm/containers ───────────────────────────────────────────────────

gtmRouter.get('/containers', async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = await resolveOrgId(req.user.id);

    const { data, error } = await supabaseAdmin
      .from('gtm_container_connections')
      .select(
        'id, client_id, property_id, container_id, account_id, auth_method, last_synced_at, created_at',
      )
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({ data: data ?? [] });
  } catch (err) {
    sendInternalError(res, err, 'GET /api/gtm/containers');
  }
});

// ── DELETE /api/gtm/containers/:id ───────────────────────────────────────────
// Disconnects a container: deletes the connection row (cascades to snapshots).
// Encrypted credentials are removed with the row.

gtmRouter.delete('/containers/:id', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  if (!id) {
    res.status(400).json({ error: 'Missing connection id' });
    return;
  }

  try {
    const orgId = await resolveOrgId(req.user.id);

    const { error } = await supabaseAdmin
      .from('gtm_container_connections')
      .delete()
      .eq('id', id)
      .eq('organization_id', orgId);

    if (error) throw error;

    logger.info({ connectionId: id, orgId }, 'GTM container disconnected');
    res.json({ data: { message: 'Container disconnected' } });
  } catch (err) {
    sendInternalError(res, err, 'DELETE /api/gtm/containers/:id');
  }
});

// ── Token refresh helper (used by sync worker) ────────────────────────────────

export async function refreshGtmToken(connectionId: string): Promise<string> {
  const { data: row, error } = await supabaseAdmin
    .from('gtm_container_connections')
    .select('oauth_credentials_encrypted')
    .eq('id', connectionId)
    .single();

  if (error || !row?.oauth_credentials_encrypted) {
    throw new Error(`No credentials found for GTM connection ${connectionId}`);
  }

  const creds = decryptGtmCredentials(row.oauth_credentials_encrypted);

  const response = await fetch(GTM_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: creds.refresh_token,
      grant_type: 'refresh_token',
    }).toString(),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GTM token refresh failed (${response.status}): ${body}`);
  }

  const tokens = await response.json() as { access_token: string; expires_in: number };
  const updated = {
    ...creds,
    access_token: tokens.access_token,
    expires_at: Date.now() + tokens.expires_in * 1000,
  };

  await supabaseAdmin
    .from('gtm_container_connections')
    .update({
      oauth_credentials_encrypted: encryptGtmCredentials(updated),
      updated_at: new Date().toISOString(),
    })
    .eq('id', connectionId);

  return tokens.access_token;
}
