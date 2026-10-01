/**
 * GTM Container Ingestion — /api/gtm
 *
 * POST /api/gtm/connect              — initiate GTM OAuth (returns authUrl)
 * GET  /api/gtm/callback             — OAuth redirect landing; exchanges code,
 *                                       discovers the user's GTM accounts/containers,
 *                                       caches the encrypted tokens under a short-lived
 *                                       ref (nothing is persisted yet — see below)
 * POST /api/gtm/callback/finalize    — user's account/container pick; persists the connection
 * POST /api/gtm/upload               — manual container JSON upload
 * POST /api/gtm/deploy               — push a generated container into a live GTM workspace (OAuth only)
 * POST /api/gtm/split-plan          — build a Google tag split delta + diff + guidance (no side effects unless persist)
 * POST /api/gtm/split-plan/deploy   — deploy that delta as a GTM draft workspace (OAuth only, never publishes)
 * POST /api/gtm/split-plan/:id/verify   — verify the split actually happened (needs fresh observations)
 * GET  /api/gtm/split-plan/:id/download — the delta as GTM import JSON
 * GET  /api/gtm/containers           — list connected containers for this org
 * DELETE /api/gtm/containers/:id     — disconnect a container (wipes credentials)
 *
 * All routes require authMiddleware + planGuard('pro').
 * The callback route additionally accepts state as a query param (browser redirect).
 *
 * Why two steps: the Tag Manager API needs a specific account_id/container_id
 * per connection, but there's no way to know which one the user wants until
 * after they've granted OAuth consent (this is the only point Atlas can call
 * accounts.list/containers.list). So /callback exchanges the code, lists what
 * the token has access to, and stashes the encrypted tokens in Redis (never
 * sent to the browser) under a one-time ref; /callback/finalize takes the
 * user's picked account_id/container_id + that ref and only then writes the
 * gtm_container_connections row.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { createHmac, randomBytes, randomUUID } from 'crypto';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authMiddleware';
import { planGuard } from '../middleware/planGuard';
import { sendInternalError } from '@/utils/apiError';
import { supabaseAdmin } from '@/services/database/supabase';
import { env } from '@/config/env';
import { encryptGtmCredentials, decryptGtmCredentials, type GtmOAuthCredentials } from '@/services/gtm/gtmCredentials';
import { parseContainerJson, validateContainerJsonShape } from '@/services/gtm/containerParser';
import { deployContainerToGtm } from '@/services/gtm/gtmDeployService';
import type { GTMContainerJSON } from '@/services/planning/generators/gtmContainerGenerator';
import { gtmContainerSyncQueue } from '@/services/queue/jobQueue';
import { loadSplitPlanContext, buildSplitPlan } from '@/services/google/googleTagSplitService';
import { evaluateSplitVerification } from '@/services/google/googleTagSplitVerification';
import { insertSplitPlan, getSplitPlan, markSplitPlanDeployed, markSplitPlanVerified } from '@/services/database/googleTagSplitPlanQueries';
import logger from '@/utils/logger';

export const gtmRouter = Router();
gtmRouter.use(authMiddleware, planGuard('pro'));

// ── Constants ─────────────────────────────────────────────────────────────────

const GTM_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GTM_TOKEN_URL = 'https://oauth2.googleapis.com/token';
// tagmanager.edit.containers (not tagmanager.publish) — /deploy below creates/
// updates a draft workspace only. The client still reviews and publishes
// manually in GTM; requesting publish scope too would be a materially bigger
// OAuth consent ask and isn't needed for this deploy path.
const GTM_SCOPE = 'https://www.googleapis.com/auth/tagmanager.readonly https://www.googleapis.com/auth/tagmanager.edit.containers';

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

// client_id rides inside the signed state (rather than a query param the
// frontend would need to persist across the full-page OAuth redirect) — an
// empty segment means "no client" (org-level connection), not a missing field.
function generateState(orgId: string, clientId?: string): string {
  const nonce = randomBytes(16).toString('hex');
  const ts = Date.now().toString();
  const payload = `${nonce}:${orgId}:${clientId ?? ''}:${ts}`;
  const hmac = createHmac('sha256', env.OAUTH_STATE_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}:${hmac}`).toString('base64url');
}

function verifyState(state: string): { orgId: string; clientId: string | null } {
  let decoded: string;
  try {
    decoded = Buffer.from(state, 'base64url').toString('utf8');
  } catch {
    throw new Error('Invalid OAuth state encoding');
  }
  const parts = decoded.split(':');
  if (parts.length !== 5) throw new Error('Invalid OAuth state format');

  const [nonce, orgId, clientId, ts, receivedHmac] = parts;
  const payload = `${nonce}:${orgId}:${clientId}:${ts}`;
  const expectedHmac = createHmac('sha256', env.OAUTH_STATE_SECRET).update(payload).digest('hex');
  if (expectedHmac !== receivedHmac) throw new Error('OAuth state HMAC verification failed');

  const age = Date.now() - parseInt(ts, 10);
  if (age > 10 * 60 * 1000) throw new Error('OAuth state expired (>10 min)');

  return { orgId, clientId: clientId || null };
}

// ── Pending connection cache (post-consent, pre-finalize) ─────────────────────
// The Tag Manager API needs to know which account/container to connect, but
// that's only choosable after the user has already granted OAuth consent —
// so the encrypted tokens live here for a short window between /callback
// (discover) and /callback/finalize (persist), never reaching the browser.

const PENDING_CONNECTION_TTL_S = 10 * 60; // 10 minutes — long enough to pick from a dropdown, short enough to limit exposure

interface PendingGtmConnection {
  orgId: string;
  clientId: string | null;
  credentials: GtmOAuthCredentials;
}

function pendingConnectionKey(ref: string): string {
  return `gtm:pending_connect:${ref}`;
}

// Dynamic import — dedupStore.ts eagerly opens a Redis connection at module
// load time (env.REDIS_URL), same reason worker.ts dynamically imports its
// own dependencies rather than importing them at the top of this file.
async function savePendingConnection(pending: PendingGtmConnection): Promise<string> {
  const { dedupRedis } = await import('@/services/capi/dedupStore');
  const ref = randomUUID();
  await dedupRedis.set(pendingConnectionKey(ref), JSON.stringify(pending), 'EX', PENDING_CONNECTION_TTL_S);
  return ref;
}

async function takePendingConnection(ref: string): Promise<PendingGtmConnection | null> {
  const { dedupRedis } = await import('@/services/capi/dedupStore');
  const key = pendingConnectionKey(ref);
  const raw = await dedupRedis.get(key);
  if (!raw) return null;
  await dedupRedis.del(key); // one-time use
  return JSON.parse(raw) as PendingGtmConnection;
}

// ── Tag Manager API discovery ─────────────────────────────────────────────────

interface GtmAccountSummary {
  accountId: string;
  name: string;
}

interface GtmContainerSummary {
  containerId: string;
  name: string;
  publicId: string;
}

export interface DiscoveredGtmAccount extends GtmAccountSummary {
  containers: GtmContainerSummary[];
}

async function discoverGtmAccounts(accessToken: string): Promise<DiscoveredGtmAccount[]> {
  const headers = { Authorization: `Bearer ${accessToken}` };

  const accountsRes = await fetch('https://www.googleapis.com/tagmanager/v2/accounts', { headers });
  if (!accountsRes.ok) {
    throw new Error(`Failed to list GTM accounts (${accountsRes.status}): ${await accountsRes.text()}`);
  }
  const accountsBody = await accountsRes.json() as { account?: GtmAccountSummary[] };
  const accounts = accountsBody.account ?? [];

  const results: DiscoveredGtmAccount[] = [];
  for (const account of accounts) {
    const containersRes = await fetch(
      `https://www.googleapis.com/tagmanager/v2/accounts/${account.accountId}/containers`,
      { headers },
    );
    if (!containersRes.ok) {
      logger.warn(
        { accountId: account.accountId, status: containersRes.status },
        'GTM discovery: failed to list containers for account — skipping',
      );
      results.push({ ...account, containers: [] });
      continue;
    }
    const containersBody = await containersRes.json() as { container?: GtmContainerSummary[] };
    results.push({ ...account, containers: containersBody.container ?? [] });
  }

  return results;
}

// ── Zod schemas ───────────────────────────────────────────────────────────────

const connectSchema = z.object({
  client_id: z.string().uuid().optional(),
});

const callbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

const finalizeSchema = z.object({
  ref: z.string().uuid(),
  account_id: z.string().min(1),
  container_id: z.string().min(1),
});

const uploadSchema = z.object({
  client_id: z.string().uuid().optional(),
  container_json: z.record(z.unknown()),
});

const deploySchema = z.object({
  connection_id: z.string().uuid(),
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
    const state = generateState(orgId, parse.data.client_id);

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
      },
    });
  } catch (err) {
    sendInternalError(res, err, 'POST /api/gtm/connect');
  }
});

// ── GET /api/gtm/callback ─────────────────────────────────────────────────────
// Called by the frontend after Google redirects back with code + state.
// Exchanges the code for tokens, discovers the accounts/containers that
// token can see, and caches the encrypted tokens under a one-time ref for
// /callback/finalize — nothing is persisted to gtm_container_connections yet.

gtmRouter.get('/callback', async (req: Request, res: Response): Promise<void> => {
  const parse = callbackSchema.safeParse(req.query);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid callback params', details: parse.error.flatten() });
    return;
  }

  const { code, state } = parse.data;

  try {
    const { orgId, clientId } = verifyState(state);

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

    const credentials: GtmOAuthCredentials = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + tokens.expires_in * 1000,
      scope: tokens.scope,
    };

    const accounts = await discoverGtmAccounts(credentials.access_token);
    const ref = await savePendingConnection({ orgId, clientId, credentials });

    logger.info({ orgId, accountCount: accounts.length }, 'GTM OAuth consent granted, accounts discovered');

    res.json({ data: { ref, accounts } });
  } catch (err) {
    if (err instanceof Error && err.message.includes('state')) {
      res.status(400).json({ error: err.message });
      return;
    }
    sendInternalError(res, err, 'GET /api/gtm/callback');
  }
});

// ── POST /api/gtm/callback/finalize ───────────────────────────────────────────
// Persists the connection once the user has picked an account/container from
// the list /callback returned. property_id has no dedicated UI concept today
// (every other write path already falls back to organization_id — see
// worker.ts's crawl-run property_id comment) — resolved the same way here.

gtmRouter.post('/callback/finalize', async (req: Request, res: Response): Promise<void> => {
  const parse = finalizeSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid request', details: parse.error.flatten() });
    return;
  }

  const { ref, account_id, container_id } = parse.data;

  try {
    const orgId = await resolveOrgId(req.user.id);
    const pending = await takePendingConnection(ref);

    if (!pending) {
      res.status(400).json({ error: 'This connection attempt has expired. Please reconnect via OAuth.' });
      return;
    }

    if (pending.orgId !== orgId) {
      res.status(403).json({ error: 'This connection attempt belongs to a different organization.' });
      return;
    }

    const { data: connection, error: insertErr } = await supabaseAdmin
      .from('gtm_container_connections')
      .insert({
        organization_id: orgId,
        client_id: pending.clientId,
        property_id: orgId,
        container_id,
        account_id,
        auth_method: 'oauth',
        oauth_credentials_encrypted: encryptGtmCredentials(pending.credentials),
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

    res.status(201).json({
      data: { connection_id: connection.id, message: 'GTM connected. Initial sync queued.' },
    });
  } catch (err) {
    sendInternalError(res, err, 'POST /api/gtm/callback/finalize');
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

  const { client_id, container_json } = parse.data;

  const validation = validateContainerJsonShape(container_json);
  if (!validation.valid) {
    res.status(400).json({ error: `Invalid GTM container JSON: ${validation.error}` });
    return;
  }

  try {
    const orgId = await resolveOrgId(req.user.id);
    const snapshot = parseContainerJson(container_json, 'manual_upload');

    // property_id has no dedicated UI concept today — every write path
    // resolves it to organization_id (see /callback/finalize above and
    // worker.ts's crawl-run property_id comment). Previously this endpoint
    // required a caller-supplied UUID; the frontend was sending the literal
    // string 'default', which failed this route's own Zod validation on
    // every manual upload.
    const { data: connection, error: connErr } = await supabaseAdmin
      .from('gtm_container_connections')
      .upsert(
        {
          organization_id: orgId,
          client_id: client_id ?? null,
          property_id: orgId,
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

// ── POST /api/gtm/deploy ──────────────────────────────────────────────────────
// Pushes an already-generated container spec (from Planning Mode's output
// generator) into the client's live GTM workspace, for OAuth-connected
// containers only. Manual-upload connections have no write credentials —
// those clients keep using the existing download/import flow.
// Never publishes — see gtmDeployService.ts's header comment.

gtmRouter.post('/deploy', async (req: Request, res: Response): Promise<void> => {
  const parse = deploySchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid request', details: parse.error.flatten() });
    return;
  }

  const { connection_id, container_json } = parse.data;

  const validation = validateContainerJsonShape(container_json);
  if (!validation.valid) {
    res.status(400).json({ error: `Invalid GTM container JSON: ${validation.error}` });
    return;
  }

  try {
    const orgId = await resolveOrgId(req.user.id);

    const { data: connection, error: connErr } = await supabaseAdmin
      .from('gtm_container_connections')
      .select('id, account_id, container_id, auth_method')
      .eq('id', connection_id)
      .eq('organization_id', orgId)
      .single();

    if (connErr || !connection) {
      res.status(404).json({ error: 'GTM connection not found' });
      return;
    }

    if (connection.auth_method !== 'oauth') {
      res.status(400).json({
        error: 'This container was connected via manual upload and has no write access. Download and import the JSON manually, or reconnect via OAuth to deploy directly.',
      });
      return;
    }

    if (!connection.account_id) {
      res.status(400).json({ error: 'This connection is missing its GTM account ID — reconnect via OAuth before deploying.' });
      return;
    }

    const accessToken = await refreshGtmToken(connection.id);
    const summary = await deployContainerToGtm(
      accessToken,
      connection.account_id,
      connection.container_id,
      container_json as unknown as GTMContainerJSON,
    );

    logger.info({ connectionId: connection.id, orgId, summary }, 'GTM container deployed');

    res.status(201).json({ data: summary });
  } catch (err) {
    sendInternalError(res, err, 'POST /api/gtm/deploy');
  }
});

// ── Google tag split plans (Google Tag Topology PRD §7, Sprint 4) ─────────────
// Same router-level gate as /deploy (authMiddleware + planGuard('pro'), D3).
// Atlas never publishes: deploy creates a draft workspace only.

const splitPlanSchema = z.object({
  connection_id: z.string().uuid(),
  persist: z.boolean().optional(),
});
const splitDeploySchema = z.object({
  connection_id: z.string().uuid(),
  plan_id: z.string().uuid().optional(),
});

gtmRouter.post('/split-plan', async (req: Request, res: Response): Promise<void> => {
  const parse = splitPlanSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid request', details: parse.error.flatten() });
    return;
  }
  try {
    const orgId = await resolveOrgId(req.user.id);
    const ctx = await loadSplitPlanContext(orgId, parse.data.connection_id);
    if (ctx === 'no_connection') { res.status(404).json({ error: 'GTM connection not found' }); return; }
    if (ctx === 'no_snapshot') { res.status(409).json({ error: 'This connection has no container snapshot yet — sync the container first.' }); return; }

    const built = buildSplitPlan(ctx);
    const deployable = built.plan.delta !== null && built.plan.conflicts.length === 0;

    let planId: string | null = null;
    if (parse.data.persist && deployable && built.plan.delta) {
      const row = await insertSplitPlan({
        organizationId: orgId,
        clientId: ctx.clientId,
        connectionId: ctx.connection.id,
        topologySnapshotIds: ctx.topologyRows.map((r) => r.id),
        delta: built.plan.delta as unknown as Record<string, unknown>,
        diff: built.plan.diff as unknown as Record<string, unknown>,
      });
      planId = row.id;
    }

    res.json({
      data: {
        plan_id: planId,
        delta: built.plan.delta,
        diff: built.plan.diff,
        conflicts: built.plan.conflicts,
        destinations: built.plan.destinations,
        guidance: built.guidance,
        topology: built.topology,
        can_deploy_draft: deployable && ctx.connection.auth_method === 'oauth' && Boolean(ctx.connection.account_id),
      },
      error: null,
      message: 'ok',
    });
  } catch (err) {
    sendInternalError(res, err, 'POST /api/gtm/split-plan');
  }
});

gtmRouter.post('/split-plan/deploy', async (req: Request, res: Response): Promise<void> => {
  const parse = splitDeploySchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid request', details: parse.error.flatten() });
    return;
  }
  try {
    const orgId = await resolveOrgId(req.user.id);
    const ctx = await loadSplitPlanContext(orgId, parse.data.connection_id);
    if (ctx === 'no_connection') { res.status(404).json({ error: 'GTM connection not found' }); return; }
    if (ctx === 'no_snapshot') { res.status(409).json({ error: 'This connection has no container snapshot yet — sync the container first.' }); return; }

    if (ctx.connection.auth_method !== 'oauth' || !ctx.connection.account_id) {
      res.status(400).json({ error: 'Deploying a draft needs an OAuth-connected container. Download the delta and import it manually instead.' });
      return;
    }

    // Recomputed server-side from the latest snapshot — never trust a client-supplied delta.
    const built = buildSplitPlan(ctx);
    if (!built.plan.delta || built.plan.conflicts.length > 0) {
      res.status(409).json({ error: 'Nothing deployable: the plan is empty or has conflicts.', data: { conflicts: built.plan.conflicts, diff: built.plan.diff } });
      return;
    }

    let existing = null;
    if (parse.data.plan_id) {
      existing = await getSplitPlan(parse.data.plan_id, orgId);
      if (!existing) { res.status(404).json({ error: 'Split plan not found' }); return; }
    }

    const accessToken = await refreshGtmToken(ctx.connection.id);
    const summary = await deployContainerToGtm(
      accessToken,
      ctx.connection.account_id,
      ctx.connection.container_id,
      built.plan.delta,
      {
        workspaceName: `Atlas · Google tag split · ${new Date().toISOString().slice(0, 10)}`,
        workspaceDescription: 'Adds a Google tag per destination. Created by Atlas. Review in GTM Preview, then publish — Atlas never publishes automatically.',
      },
    );

    const deltaJson = built.plan.delta as unknown as Record<string, unknown>;
    const diffJson = built.plan.diff as unknown as Record<string, unknown>;
    const row = existing
      ? await markSplitPlanDeployed(existing.id, { delta: deltaJson, diff: diffJson, workspaceId: summary.workspace_id })
      : await insertSplitPlan({
          organizationId: orgId,
          clientId: ctx.clientId,
          connectionId: ctx.connection.id,
          topologySnapshotIds: ctx.topologyRows.map((r) => r.id),
          delta: deltaJson,
          diff: diffJson,
          status: 'deployed_draft',
          deployedWorkspaceId: summary.workspace_id,
        });

    logger.info({ connectionId: ctx.connection.id, orgId, planId: row.id }, 'Google tag split draft deployed');
    res.status(201).json({ data: { plan_id: row.id, status: row.status, ...summary }, error: null, message: 'Draft workspace created. Nothing has been published.' });
  } catch (err) {
    sendInternalError(res, err, 'POST /api/gtm/split-plan/deploy');
  }
});

gtmRouter.post('/split-plan/:id/verify', async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = await resolveOrgId(req.user.id);
    const plan = await getSplitPlan(req.params['id'], orgId);
    if (!plan) { res.status(404).json({ error: 'Split plan not found' }); return; }
    if (plan.status === 'abandoned') { res.status(409).json({ error: 'This plan was abandoned.' }); return; }
    if (!plan.connection_id) { res.status(400).json({ error: 'This plan has no connection to verify against.' }); return; }

    const ctx = await loadSplitPlanContext(orgId, plan.connection_id);
    if (ctx === 'no_connection') { res.status(404).json({ error: 'GTM connection not found' }); return; }

    const result = evaluateSplitVerification({
      planStartedAt: new Date(plan.deployed_at ?? plan.created_at),
      snapshot: ctx === 'no_snapshot' ? null : ctx.snapshot,
      topologyRows: ctx === 'no_snapshot' ? [] : ctx.topologyRows,
      secondaryDomains: ctx === 'no_snapshot' ? [] : ctx.secondaryDomains,
    });

    let status: string = plan.status;
    if (result.verified && plan.status !== 'verified') {
      // The client-scoped discontinuity (PRD §8.1) is written by Sprint 5 once
      // platform_discontinuities gains client_id/kind.
      status = (await markSplitPlanVerified(plan.id)).status;
    }
    res.json({ data: { plan_id: plan.id, status, verified: result.verified, reasons: result.reasons, topology: result.topology }, error: null, message: 'ok' });
  } catch (err) {
    sendInternalError(res, err, 'POST /api/gtm/split-plan/:id/verify');
  }
});

gtmRouter.get('/split-plan/:id/download', async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = await resolveOrgId(req.user.id);
    const plan = await getSplitPlan(req.params['id'], orgId);
    if (!plan) { res.status(404).json({ error: 'Split plan not found' }); return; }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="atlas-google-tag-split-${plan.id.slice(0, 8)}.json"`);
    res.send(JSON.stringify(plan.delta, null, 2));
  } catch (err) {
    sendInternalError(res, err, 'GET /api/gtm/split-plan/:id/download');
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
