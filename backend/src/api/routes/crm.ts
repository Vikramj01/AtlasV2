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
 *                                                    §6.2 readiness check server-side, rejects
 *                                                    unless it comes back READY, and on the
 *                                                    off→on transition enqueues the first
 *                                                    crmSyncQueue run (worker.ts self-re-enqueues
 *                                                    every sync_interval_minutes after that)
 * POST /api/crm/configs/:id/readiness            — run the §6.2 readiness check on demand
 * POST /api/crm/configs/:id/sync                 — enqueue one immediate sync run outside the
 *                                                    rolling schedule (support/testing)
 * GET  /api/crm/configs/:id/pipelines            — list CRM pipelines/stages for the mapping UI
 * GET  /api/crm/configs/:id/stage-mappings       — the saved ladder, or an objectMapper-built
 *                                                    draft from the pipeline when nothing is saved
 * PUT  /api/crm/configs/:id/stage-mappings       — replace the whole ladder
 * DELETE /api/crm/configs/:id                    — remove config (connection removal reuses
 *                                                    the generic DELETE /api/connections/:id)
 *
 * All routes require authMiddleware + planGuard('pro') (D4). Outcomes and
 * derived-value listing land in Sprint 5+ — not yet implemented here.
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
import type { CrmAccountInfo, CrmPipeline, DecryptedTokens } from '@/services/crm/providers/types';
import { encryptTokens, resolveTokens } from '@/services/connections/tokenManager';
import { getConnectionById } from '@/services/database/connectionQueries';
import {
  listCrmSyncConfigsForOrg,
  getCrmSyncConfigById,
  createCrmSyncConfig,
  updateCrmSyncConfig,
  deleteCrmSyncConfig,
  listCrmStageMappings,
  replaceCrmStageMappings,
  countRecentOutcomesByMapping,
} from '@/services/database/crmQueries';
import { runReadinessCheck } from '@/services/crm/readinessCheck';
import { buildDefaultStageMappings } from '@/services/crm/objectMapper';
import { resolveValue } from '@/services/crm/valueLadder';
import { getProvider } from '@/services/crm/providerRegistry';
import { crmSyncQueue } from '@/services/queue/jobQueue';
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

async function checkReadinessForConfig(config: CrmSyncConfig) {
  const provider = getProvider(config.provider);
  const tokens = await resolveTokens(config.connection_id);
  return runReadinessCheck(provider, tokens, config.tracked_object, config.identity_property_map);
}

// The ladder view has no specific CRM record in hand, so this is "what
// would be used right now" absent a record's own observed amount or a
// Sprint 7 derived-value snapshot — both null here, never fabricated.
function withResolvedValue<T extends { is_terminal_won?: boolean; declared_value?: number | null; currency?: string | null }>(
  mapping: T,
  config: Pick<CrmSyncConfig, 'value_mode' | 'default_currency'>,
) {
  const resolved_value = resolveValue(
    { is_terminal_won: mapping.is_terminal_won ?? false, declared_value: mapping.declared_value ?? null, currency: mapping.currency ?? null },
    config,
    null,
    null,
  );
  return { ...mapping, resolved_value };
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

const stageMappingSchema = z.object({
  crm_stage_id: z.string().min(1),
  crm_stage_label: z.string().optional(),
  stage_order: z.number().int(),
  atlas_event_name: z.string().min(1),
  is_terminal_won: z.boolean().optional(),
  is_terminal_lost: z.boolean().optional(),
  declared_value: z.number().nonnegative().nullable().optional(),
  currency: z.string().length(3).nullable().optional(),
  google_conversion_action_id: z.string().nullable().optional(),
  meta_event_name: z.string().nullable().optional(),
  linkedin_conversion_id: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
});

const replaceStageMappingsSchema = z.array(stageMappingSchema);

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

    // Kick off the rolling sync chain on the off→on transition only — the
    // worker re-enqueues itself every sync_interval_minutes afterwards
    // (see worker.ts), so re-PATCHing sync_enabled: true while it's already
    // true must not spawn a second parallel chain.
    if (parse.data.sync_enabled === true && !existing.sync_enabled) {
      await crmSyncQueue.add({ config_id: updated.id });
    }

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

// ── POST /api/crm/configs/:id/sync ─────────────────────────────────────────────
// Enqueues one immediate crmSyncQueue run outside the config's own rolling
// schedule — for support/testing, not a replacement for sync_enabled's
// self-re-enqueuing chain (worker.ts).

crmRouter.post('/configs/:id/sync', async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = await resolveOrgId(req.user.id);
    const config = await getCrmSyncConfigById(req.params.id, orgId);
    if (!config) {
      res.status(404).json({ error: 'CRM sync config not found' });
      return;
    }
    if (!config.sync_enabled) {
      res.status(400).json({ error: 'Sync is not enabled for this config — enable it first (PATCH sync_enabled: true).' });
      return;
    }

    await crmSyncQueue.add({ config_id: config.id });
    res.status(202).json({ data: { message: 'Sync run enqueued.' } });
  } catch (err) {
    sendInternalError(res, err, 'POST /api/crm/configs/:id/sync');
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

// ── GET /api/crm/configs/:id/stage-mappings ────────────────────────────────────
// Returns the saved ladder, or — when nothing has been saved yet — a
// draft built by objectMapper.ts from the connected pipeline's stages
// (is_draft: true), so StageLadderEditor always has something to render
// and the operator edits/confirms rather than starting from a blank form.

crmRouter.get('/configs/:id/stage-mappings', async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = await resolveOrgId(req.user.id);
    const config = await getCrmSyncConfigById(req.params.id, orgId);
    if (!config) {
      res.status(404).json({ error: 'CRM sync config not found' });
      return;
    }

    const saved = await listCrmStageMappings(config.id);

    if (saved.length > 0) {
      const counts = await countRecentOutcomesByMapping(config.id);
      res.json({
        data: {
          is_draft: false,
          mappings: saved.map((m) => withResolvedValue({ ...m, outcomes_last_30d: counts[m.id] ?? 0 }, config)),
        },
      });
      return;
    }

    const provider = getProvider(config.provider);
    const tokens = await resolveTokens(config.connection_id);
    const pipelines = await provider.listPipelines(tokens);
    const pipeline = pipelines.find((p) => p.id === config.pipeline_id) ?? pipelines[0];

    if (!pipeline) {
      res.json({ data: { is_draft: true, mappings: [] } });
      return;
    }

    const draft = buildDefaultStageMappings(pipeline).map((m) => withResolvedValue({ ...m, outcomes_last_30d: 0 }, config));
    res.json({ data: { is_draft: true, mappings: draft } });
  } catch (err) {
    sendInternalError(res, err, 'GET /api/crm/configs/:id/stage-mappings');
  }
});

// ── PUT /api/crm/configs/:id/stage-mappings ────────────────────────────────────
// Replaces the whole ladder (PRD §11) — see replaceCrmStageMappings()'s own
// comment for why this upserts by crm_stage_id rather than delete+reinsert.

crmRouter.put('/configs/:id/stage-mappings', async (req: Request, res: Response): Promise<void> => {
  const parse = replaceStageMappingsSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid request', details: parse.error.flatten() });
    return;
  }

  try {
    const orgId = await resolveOrgId(req.user.id);
    const config = await getCrmSyncConfigById(req.params.id, orgId);
    if (!config) {
      res.status(404).json({ error: 'CRM sync config not found' });
      return;
    }

    const mappings = await replaceCrmStageMappings(config.id, orgId, parse.data);
    const counts = await countRecentOutcomesByMapping(config.id);
    res.json({
      data: {
        is_draft: false,
        mappings: mappings.map((m) => withResolvedValue({ ...m, outcomes_last_30d: counts[m.id] ?? 0 }, config)),
      },
    });
  } catch (err) {
    sendInternalError(res, err, 'PUT /api/crm/configs/:id/stage-mappings');
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
