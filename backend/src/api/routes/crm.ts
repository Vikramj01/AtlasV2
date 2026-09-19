/**
 * CRM Outcome Integration — /api/crm
 *
 * GET  /api/crm/oauth/hubspot/start              — begin OAuth, returns authUrl
 * GET  /api/crm/oauth/hubspot/callback           — OAuth redirect landing; exchanges
 *                                                    code, discovers portal + pipelines,
 *                                                    caches pending encrypted tokens in
 *                                                    Redis under a one-time ref — nothing
 *                                                    is persisted yet (mirrors gtm.ts)
 * POST /api/crm/oauth/hubspot/callback/finalize  — persists the platform_connections row
 * GET  /api/crm/configs                          — list configs for org
 * POST /api/crm/configs                          — create config for a client
 * PATCH /api/crm/configs/:id                     — update mapping, value mode, schedule —
 *                                                    setting sync_enabled: true re-runs the
 *                                                    §6.2 readiness check server-side and is
 *                                                    rejected unless it comes back READY
 * POST /api/crm/configs/:id/readiness            — run the §6.2 readiness check on demand
 * GET  /api/crm/configs/:id/pipelines            — list CRM pipelines/stages for the mapping UI
 * DELETE /api/crm/configs/:id                    — remove config (connection removal reuses
 *                                                    the generic DELETE /api/connections/:id)
 *
 * All routes require authMiddleware + planGuard('pro') (D4). Stage-mapping
 * CRUD, sync trigger, outcomes and derived-value listing land in Sprint 3+
 * — not yet implemented here.
 *
 * Why two-phase OAuth: a HubSpot portal has no single "which pipeline"
 * answer until after consent is granted (the same reason the GTM OAuth
 * Connect UI sprint moved to two phases) — /callback exchanges the code,
 * calls testConnection + listPipelines with the fresh token, and stashes
 * the encrypted tokens in Redis under a one-time ref; /callback/finalize
 * takes that ref and only then writes the platform_connections row.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authMiddleware';
import { planGuard } from '../middleware/planGuard';
import { sendInternalError } from '@/utils/apiError';
import { supabaseAdmin } from '@/services/database/supabase';
import * as hubspotOAuth from '@/services/connections/oauthFlows/hubspotOAuth';
import { hubspotClient } from '@/services/crm/providers/hubspotClient';
import type { CrmProvider, CrmAccountInfo, CrmPipeline, DecryptedTokens } from '@/services/crm/providers/types';
import { encryptTokens, resolveTokens } from '@/services/connections/tokenManager';
import { getConnectionById } from '@/services/database/connectionQueries';
import {
  listCrmSyncConfigsForOrg,
  getCrmSyncConfigById,
  createCrmSyncConfig,
  updateCrmSyncConfig,
  deleteCrmSyncConfig,
} from '@/services/database/crmQueries';
import { runReadinessCheck } from '@/services/crm/readinessCheck';
import type { CrmProviderName, CrmSyncConfig } from '@/types/crm';
import logger from '@/utils/logger';

export const crmRouter = Router();
crmRouter.use(authMiddleware, planGuard('pro'));

// ── Helpers ───────────────────────────────────────────────────────────────────

async function resolveOrgId(userId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('organization_id')
    .eq('id', userId)
    .single();
  return (data as { organization_id: string } | null)?.organization_id ?? userId;
}

// Providers implemented so far — Salesforce joins this map in Sprint 10.
const PROVIDERS: Partial<Record<CrmProviderName, CrmProvider>> = {
  hubspot: hubspotClient,
};

function getProvider(name: CrmProviderName): CrmProvider {
  const provider = PROVIDERS[name];
  if (!provider) throw new Error(`CRM provider '${name}' is not yet supported`);
  return provider;
}

async function checkReadinessForConfig(config: CrmSyncConfig) {
  const provider = getProvider(config.provider);
  const tokens = await resolveTokens(config.connection_id);
  return runReadinessCheck(provider, tokens, config.tracked_object, config.identity_property_map);
}

// ── Pending connection cache (post-consent, pre-finalize) ─────────────────────
// Same shape and TTL as gtm.ts's PendingGtmConnection — the discovered
// account/pipelines live here only long enough for the user to confirm,
// never reaching the browser as raw tokens.

const PENDING_CONNECTION_TTL_S = 10 * 60;

interface PendingCrmConnection {
  orgId: string;
  clientId: string | null;
  provider: CrmProviderName;
  tokens: DecryptedTokens;
  account: CrmAccountInfo;
}

function pendingConnectionKey(ref: string): string {
  return `crm:pending_connect:${ref}`;
}

// Dynamic import — dedupStore.ts eagerly opens a Redis connection at module
// load time, same reason gtm.ts and worker.ts dynamically import it.
async function savePendingConnection(pending: PendingCrmConnection): Promise<string> {
  const { dedupRedis } = await import('@/services/capi/dedupStore');
  const ref = randomUUID();
  await dedupRedis.set(pendingConnectionKey(ref), JSON.stringify(pending), 'EX', PENDING_CONNECTION_TTL_S);
  return ref;
}

async function takePendingConnection(ref: string): Promise<PendingCrmConnection | null> {
  const { dedupRedis } = await import('@/services/capi/dedupStore');
  const key = pendingConnectionKey(ref);
  const raw = await dedupRedis.get(key);
  if (!raw) return null;
  await dedupRedis.del(key); // one-time use
  return JSON.parse(raw) as PendingCrmConnection;
}

// ── Zod schemas ───────────────────────────────────────────────────────────────

const oauthStartSchema = z.object({
  client_id: z.string().uuid().optional(),
});

const oauthCallbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

const oauthFinalizeSchema = z.object({
  ref: z.string().uuid(),
});

const createConfigSchema = z.object({
  client_id: z.string().uuid(),
  connection_id: z.string().uuid(),
  provider: z.enum(['hubspot', 'salesforce']),
  pipeline_id: z.string().nullable().optional(),
  tracked_object: z.enum(['contact', 'deal']).optional(),
  identity_property_map: z.record(z.string()).optional(),
  value_mode: z.enum(['DECLARED', 'DERIVED']).optional(),
  default_currency: z.string().length(3).optional(),
  backfill_days: z.number().int().min(0).max(90).optional(),
});

const updateConfigSchema = z.object({
  pipeline_id: z.string().nullable().optional(),
  tracked_object: z.enum(['contact', 'deal']).optional(),
  identity_property_map: z.record(z.string()).optional(),
  value_mode: z.enum(['DECLARED', 'DERIVED']).optional(),
  default_currency: z.string().length(3).optional(),
  backfill_days: z.number().int().min(0).max(90).optional(),
  sync_enabled: z.boolean().optional(),
  sync_interval_minutes: z.number().int().min(60).optional(),
  write_back_enabled: z.boolean().optional(),
});

// ── GET /api/crm/oauth/hubspot/start ──────────────────────────────────────────

crmRouter.get('/oauth/hubspot/start', async (req: Request, res: Response): Promise<void> => {
  const parse = oauthStartSchema.safeParse(req.query);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid request', details: parse.error.flatten() });
    return;
  }

  try {
    const state = hubspotOAuth.generateState(parse.data.client_id);
    res.json({ data: { auth_url: hubspotOAuth.getAuthUrl(state), state } });
  } catch (err) {
    sendInternalError(res, err, 'GET /api/crm/oauth/hubspot/start');
  }
});

// ── GET /api/crm/oauth/hubspot/callback ───────────────────────────────────────

crmRouter.get('/oauth/hubspot/callback', async (req: Request, res: Response): Promise<void> => {
  const parse = oauthCallbackSchema.safeParse(req.query);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid callback params', details: parse.error.flatten() });
    return;
  }

  const { code, state } = parse.data;

  try {
    const { clientId } = hubspotOAuth.verifyState(state);
    const orgId = await resolveOrgId(req.user.id);

    const tokens = await hubspotOAuth.handleCallback(code);
    const account = await hubspotClient.testConnection(tokens);
    const pipelines: CrmPipeline[] = await hubspotClient.listPipelines(tokens);

    const ref = await savePendingConnection({
      orgId,
      clientId: clientId ?? null,
      provider: 'hubspot',
      tokens,
      account,
    });

    logger.info({ orgId, hubId: account.account_id }, 'HubSpot OAuth consent granted, portal discovered');

    res.json({ data: { ref, account, pipelines } });
  } catch (err) {
    if (err instanceof Error && err.message.includes('state')) {
      res.status(400).json({ error: err.message });
      return;
    }
    sendInternalError(res, err, 'GET /api/crm/oauth/hubspot/callback');
  }
});

// ── POST /api/crm/oauth/hubspot/callback/finalize ─────────────────────────────

crmRouter.post('/oauth/hubspot/callback/finalize', async (req: Request, res: Response): Promise<void> => {
  const parse = oauthFinalizeSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid request', details: parse.error.flatten() });
    return;
  }

  try {
    const orgId = await resolveOrgId(req.user.id);
    const pending = await takePendingConnection(parse.data.ref);

    if (!pending) {
      res.status(400).json({ error: 'This connection attempt has expired. Please reconnect via OAuth.' });
      return;
    }
    if (pending.orgId !== orgId) {
      res.status(403).json({ error: 'This connection attempt belongs to a different organization.' });
      return;
    }

    // Raw upsert rather than the typed upsertConnection() helper — its
    // Platform union (types/connections.ts) covers only the four
    // reconciliation-flow platforms, the same reason connections.ts's own
    // Klaviyo connect route bypasses it and writes 'klaviyo' directly.
    const { data: connection, error: insertErr } = await supabaseAdmin
      .from('platform_connections')
      .upsert(
        {
          organization_id: orgId,
          client_id: pending.clientId,
          platform: pending.provider,
          connection_type: 'standalone',
          account_id: pending.account.account_id,
          account_label: pending.account.account_label,
          oauth_tokens: encryptTokens(pending.tokens),
          status: 'active',
          last_error: null,
          metadata: {},
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'organization_id,platform,account_id' },
      )
      .select('id')
      .single();

    if (insertErr || !connection) {
      throw new Error(`Failed to store HubSpot connection: ${insertErr?.message}`);
    }

    logger.info({ connectionId: connection.id, orgId }, 'HubSpot connection created');

    res.status(201).json({
      data: { connection_id: connection.id, account: pending.account },
    });
  } catch (err) {
    sendInternalError(res, err, 'POST /api/crm/oauth/hubspot/callback/finalize');
  }
});

// ── GET /api/crm/configs ───────────────────────────────────────────────────────

crmRouter.get('/configs', async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = await resolveOrgId(req.user.id);
    const configs = await listCrmSyncConfigsForOrg(orgId);
    res.json({ data: configs });
  } catch (err) {
    sendInternalError(res, err, 'GET /api/crm/configs');
  }
});

// ── POST /api/crm/configs ──────────────────────────────────────────────────────

crmRouter.post('/configs', async (req: Request, res: Response): Promise<void> => {
  const parse = createConfigSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid request', details: parse.error.flatten() });
    return;
  }

  try {
    const orgId = await resolveOrgId(req.user.id);

    const connection = await getConnectionById(parse.data.connection_id, orgId);
    if (!connection) {
      res.status(404).json({ error: 'Connection not found' });
      return;
    }
    // connection.platform is typed as the reconciliation-flow Platform union
    // (types/connections.ts), which doesn't include 'hubspot'/'salesforce' —
    // same reason the finalize handler above bypasses upsertConnection().
    const connectionPlatform = connection.platform as unknown as string;
    if (connectionPlatform !== parse.data.provider) {
      res.status(400).json({ error: `Connection platform '${connectionPlatform}' does not match provider '${parse.data.provider}'` });
      return;
    }

    const config = await createCrmSyncConfig(orgId, parse.data);
    res.status(201).json({ data: config });
  } catch (err) {
    // crm_sync_configs.client_id is UNIQUE (one config per client) — Postgres's
    // own unique-violation message text, since createCrmSyncConfig only
    // forwards error.message, not the separate PostgrestError.code field.
    if (err instanceof Error && err.message.includes('duplicate key value violates unique constraint')) {
      res.status(409).json({ error: 'This client already has a CRM sync config.' });
      return;
    }
    sendInternalError(res, err, 'POST /api/crm/configs');
  }
});

// ── PATCH /api/crm/configs/:id ─────────────────────────────────────────────────
// Per the PRD's §6.2 sequencing note ("do not proceed past a
// PROPERTIES_PRESENT_NO_DATA verdict"), turning sync_enabled on re-runs the
// readiness check server-side rather than trusting the frontend to have
// called /readiness first — a POST /readiness call the UI forgot to make
// (or a client re-pointed at a different, unwired portal after the last
// check) must not be able to slip an unready config into a real sync run.

crmRouter.patch('/configs/:id', async (req: Request, res: Response): Promise<void> => {
  const parse = updateConfigSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid request', details: parse.error.flatten() });
    return;
  }

  try {
    const orgId = await resolveOrgId(req.user.id);
    const existing = await getCrmSyncConfigById(req.params.id, orgId);
    if (!existing) {
      res.status(404).json({ error: 'CRM sync config not found' });
      return;
    }

    if (parse.data.sync_enabled === true) {
      const readiness = await checkReadinessForConfig(existing);
      if (readiness.verdict !== 'READY') {
        res.status(400).json({
          error: `Cannot enable sync — readiness check returned ${readiness.verdict}: ${readiness.message}`,
          readiness,
        });
        return;
      }
    }

    const updated = await updateCrmSyncConfig(req.params.id, orgId, parse.data);
    res.json({ data: updated });
  } catch (err) {
    sendInternalError(res, err, 'PATCH /api/crm/configs/:id');
  }
});

// ── POST /api/crm/configs/:id/readiness ────────────────────────────────────────

crmRouter.post('/configs/:id/readiness', async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = await resolveOrgId(req.user.id);
    const config = await getCrmSyncConfigById(req.params.id, orgId);
    if (!config) {
      res.status(404).json({ error: 'CRM sync config not found' });
      return;
    }

    const readiness = await checkReadinessForConfig(config);
    res.json({ data: readiness });
  } catch (err) {
    sendInternalError(res, err, 'POST /api/crm/configs/:id/readiness');
  }
});

// ── GET /api/crm/configs/:id/pipelines ─────────────────────────────────────────

crmRouter.get('/configs/:id/pipelines', async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = await resolveOrgId(req.user.id);
    const config = await getCrmSyncConfigById(req.params.id, orgId);
    if (!config) {
      res.status(404).json({ error: 'CRM sync config not found' });
      return;
    }

    const provider = getProvider(config.provider);
    const tokens = await resolveTokens(config.connection_id);
    const pipelines = await provider.listPipelines(tokens);

    res.json({ data: pipelines });
  } catch (err) {
    sendInternalError(res, err, 'GET /api/crm/configs/:id/pipelines');
  }
});

// ── DELETE /api/crm/configs/:id ────────────────────────────────────────────────
// Removes the sync config only. Connection removal reuses the generic
// DELETE /api/connections/:id, per the PRD's API surface table.

crmRouter.delete('/configs/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = await resolveOrgId(req.user.id);
    const existing = await getCrmSyncConfigById(req.params.id, orgId);
    if (!existing) {
      res.status(404).json({ error: 'CRM sync config not found' });
      return;
    }

    await deleteCrmSyncConfig(req.params.id, orgId);
    res.json({ data: { message: 'CRM sync config removed' } });
  } catch (err) {
    sendInternalError(res, err, 'DELETE /api/crm/configs/:id');
  }
});
