/**
 * CRM Outcome Integration — /api/outcomes
 *
 * GET  /api/outcomes/oauth/hubspot/start              — begin OAuth, returns authUrl
 * GET  /api/outcomes/oauth/hubspot/callback           — OAuth redirect landing; exchanges
 *                                                    code, discovers portal + pipelines,
 *                                                    caches pending encrypted tokens in
 *                                                    Redis under a one-time ref — nothing
 *                                                    is persisted yet (mirrors gtm.ts)
 * POST /api/outcomes/oauth/hubspot/callback/finalize  — persists the platform_connections row
 * GET  /api/outcomes/oauth/salesforce/start           — Sprint 10 — begin OAuth, optional
 *                                                    ?sandbox=true for a test.salesforce.com org
 * GET  /api/outcomes/oauth/salesforce/callback        — same two-phase shape as HubSpot's
 * POST /api/outcomes/oauth/salesforce/callback/finalize — shares finalizeConnection() with HubSpot's
 * GET  /api/outcomes/configs                          — list configs for org
 * POST /api/outcomes/configs                          — create config for a client
 * PATCH /api/outcomes/configs/:id                     — update mapping, value mode, schedule —
 *                                                    setting sync_enabled: true re-runs the
 *                                                    §6.2 readiness check server-side, rejects
 *                                                    unless it comes back READY, and on the
 *                                                    off→on transition enqueues the first
 *                                                    outcomeSyncQueue run (worker.ts self-re-enqueues
 *                                                    every sync_interval_minutes after that)
 * POST /api/outcomes/configs/:id/readiness            — run the §6.2 readiness check on demand
 * POST /api/outcomes/configs/:id/sync                 — enqueue one immediate sync run outside the
 *                                                    rolling schedule (support/testing)
 * GET  /api/outcomes/configs/:id/pipelines            — list CRM pipelines/stages for the mapping UI
 * GET  /api/outcomes/configs/:id/stage-mappings       — the saved ladder, or an objectMapper-built
 *                                                    draft from the pipeline when nothing is saved
 * PUT  /api/outcomes/configs/:id/stage-mappings       — replace the whole ladder
 * GET  /api/outcomes/configs/:id/derived-values       — latest crm_derived_value_snapshots per stage
 *                                                    (Sprint 7) — whatever the weekly
 *                                                    derivedValueCalculator.ts job last computed;
 *                                                    this route triggers no computation itself
 * GET  /api/outcomes/configs/:id/outcomes             — paginated crm_outcome_events (Sprint 8),
 *                                                    optional ?delivery_status filter
 * GET  /api/outcomes/configs/:id/outcomes/daily       — real day-grouped counts backing
 *                                                    CrmOutcomesTab's chart (Sprint 8)
 * DELETE /api/outcomes/configs/:id                    — remove config (connection removal reuses
 *                                                    the generic DELETE /api/connections/:id)
 *
 * All routes require authMiddleware + planGuard('pro') (D4).
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
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authMiddleware';
import { planGuard } from '../middleware/planGuard';
import { sendInternalError } from '@/utils/apiError';
import { supabaseAdmin } from '@/services/database/supabase';
import { env } from '@/config/env';
import * as hubspotOAuth from '@/services/connections/oauthFlows/hubspotOAuth';
import * as salesforceOAuth from '@/services/connections/oauthFlows/salesforceOAuth';
import { hubspotClient } from '@/services/outcomes/sources/hubspotClient';
import { salesforceClient } from '@/services/outcomes/sources/salesforceClient';
import type { CrmAccountInfo, CrmPipeline, DecryptedTokens } from '@/services/outcomes/sources/types';
import { encryptTokens, resolveTokens } from '@/services/connections/tokenManager';
import { getConnectionById } from '@/services/database/connectionQueries';
import {
  listOutcomeSourceConfigsForOrg,
  getOutcomeSourceConfigById,
  getOutcomeSourceConfigByIdInternal,
  createOutcomeSourceConfig,
  createWebhookOutcomeSourceConfig,
  updateOutcomeSourceConfig,
  deleteOutcomeSourceConfig,
  listOutcomeStageMappings,
  replaceOutcomeStageMappings,
  countRecentOutcomesByMapping,
  getLatestDerivedValueSnapshots,
  getRecentIdentityMethodsForConfig,
  listOutcomeEvents,
  getDailyOutcomeCounts,
} from '@/services/database/outcomeQueries';
import { runReadinessCheck } from '@/services/outcomes/readinessCheck';
import { buildDefaultStageMappings } from '@/services/outcomes/objectMapper';
import { resolveValue } from '@/services/outcomes/valueLadder';
import type { DerivedValueInput } from '@/services/outcomes/valueLadder';
import { getProvider } from '@/services/outcomes/sourceRegistry';
import { outcomeSyncQueue } from '@/services/queue/jobQueue';
import { getLatestAttributionChainForClient } from '@/services/attribution/attributionAdvisory';
import { computeTierStats } from '@/services/outcomes/deliveryGate';
import { runWebhookIngest } from '@/services/outcomes/webhookIngest';
import {
  generateWebhookSecret,
  encryptWebhookSecret,
  decryptWebhookSecret,
  verifyWebhookRequest,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
} from '@/services/outcomes/webhookAuth';
import type { OutcomeSourceType, OutcomeSourceConfig, OutcomeDerivedValueSnapshot } from '@/types/outcomes';
import logger from '@/utils/logger';

export const outcomesRouter = Router();
outcomesRouter.use(authMiddleware, planGuard('pro'));

// ── Helpers ───────────────────────────────────────────────────────────────────

async function resolveOrgId(userId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('organization_id')
    .eq('id', userId)
    .single();
  return (data as { organization_id: string } | null)?.organization_id ?? userId;
}

async function checkReadinessForConfig(config: OutcomeSourceConfig) {
  // Readiness checking is a pull-source concept (readinessCheck.ts itself
  // requires listProperties, which a push source doesn't implement) — a
  // webhook config (connection_id null by construction) should never
  // reach this, but guard explicitly rather than letting resolveTokens(null)
  // fail with an unrelated-looking error.
  if (!config.connection_id) {
    throw new Error(`Outcome source config ${config.id} has no connection_id — readiness checking only applies to pull sources`);
  }
  const provider = getProvider(config.source_type);
  const tokens = await resolveTokens(config.connection_id);
  return runReadinessCheck(provider, tokens, config.tracked_object, config.identity_property_map);
}

// listPipelines is optional on OutcomeSource (a push source has no
// pipeline concept) — every source getProvider() can currently resolve
// (hubspot/salesforce) implements it, so this only guards a future push
// source being routed here by mistake, never a real gap today.
async function requireListPipelines(provider: ReturnType<typeof getProvider>) {
  if (!provider.listPipelines) {
    throw new Error(`Outcome source '${provider.name}' does not support pipeline discovery`);
  }
  return provider.listPipelines;
}

// The ladder view has no specific CRM record in hand, so the observed
// amount is always null here (never fabricated). The derived value,
// though, is real when supplied (Sprint 7) — whatever
// derivedValueCalculator.ts's weekly job last computed for this stage —
// so the ladder shows the same DERIVED/withheld state a live sync run
// would actually resolve, not an unconditional DECLARED placeholder.
function withResolvedValue<T extends { crm_stage_id: string; is_terminal_won?: boolean; declared_value?: number | null; currency?: string | null }>(
  mapping: T,
  config: Pick<OutcomeSourceConfig, 'value_mode' | 'default_currency'>,
  derivedByStage?: Map<string, DerivedValueInput>,
) {
  const resolved_value = resolveValue(
    { is_terminal_won: mapping.is_terminal_won ?? false, declared_value: mapping.declared_value ?? null, currency: mapping.currency ?? null },
    config,
    null,
    derivedByStage?.get(mapping.crm_stage_id) ?? null,
  );
  return { ...mapping, resolved_value };
}

function buildDerivedByStageMap(snapshots: OutcomeDerivedValueSnapshot[]): Map<string, DerivedValueInput> {
  return new Map(snapshots.map((s) => [s.crm_stage_id, { value: s.derived_value, currency: s.currency, confidence: s.confidence }]));
}

// ── Pending connection cache (post-consent, pre-finalize) ─────────────────────
// Same shape and TTL as gtm.ts's PendingGtmConnection — the discovered
// account/pipelines live here only long enough for the user to confirm,
// never reaching the browser as raw tokens.

const PENDING_CONNECTION_TTL_S = 10 * 60;

interface PendingOutcomeConnection {
  orgId: string;
  clientId: string | null;
  provider: OutcomeSourceType;
  tokens: DecryptedTokens;
  account: CrmAccountInfo;
  // Salesforce only (Sprint 10) — which login host (production/sandbox)
  // this connection was authorized against, persisted into
  // platform_connections.metadata at finalize time so a future refresh
  // call (not yet wired for either provider — see salesforceOAuth.ts's
  // module header) knows which host to refresh against.
  sandbox?: boolean;
}

function pendingConnectionKey(ref: string): string {
  return `outcome:pending_connect:${ref}`;
}

// Dynamic import — dedupStore.ts eagerly opens a Redis connection at module
// load time, same reason gtm.ts and worker.ts dynamically import it.
async function savePendingConnection(pending: PendingOutcomeConnection): Promise<string> {
  const { dedupRedis } = await import('@/services/capi/dedupStore');
  const ref = randomUUID();
  await dedupRedis.set(pendingConnectionKey(ref), JSON.stringify(pending), 'EX', PENDING_CONNECTION_TTL_S);
  return ref;
}

async function takePendingConnection(ref: string): Promise<PendingOutcomeConnection | null> {
  const { dedupRedis } = await import('@/services/capi/dedupStore');
  const key = pendingConnectionKey(ref);
  const raw = await dedupRedis.get(key);
  if (!raw) return null;
  await dedupRedis.del(key); // one-time use
  return JSON.parse(raw) as PendingOutcomeConnection;
}

// ── Zod schemas ───────────────────────────────────────────────────────────────

const oauthStartSchema = z.object({
  client_id: z.string().uuid().optional(),
});

const salesforceOauthStartSchema = z.object({
  client_id: z.string().uuid().optional(),
  sandbox: z.coerce.boolean().optional(),
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
  source_type: z.enum(['hubspot', 'salesforce']),
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
  // Phase 3 (§6.3) — an operator setting this true always clears
  // delivery_disabled_reason (see the route below); the gate itself only
  // ever sets that field back, never through this schema.
  delivery_enabled: z.boolean().optional(),
});

// Phase 3 (§6.1) — deliberately its own schema, not createConfigSchema
// widened, since a webhook config takes no connection_id/source_type/
// pipeline_id/identity_property_map/backfill_days at all.
const createWebhookConfigSchema = z.object({
  client_id: z.string().uuid(),
  tracked_object: z.enum(['contact', 'deal']).optional(),
  value_mode: z.enum(['DECLARED', 'DERIVED']).optional(),
  default_currency: z.string().length(3).optional(),
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

const listOutcomesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  delivery_status: z.enum([
    'pending', 'delivered', 'partial', 'failed',
    'skipped_unresolved', 'skipped_window', 'dedup_skipped',
  ]).optional(),
});

const dailyOutcomesQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).optional(),
});

// ── GET /api/outcomes/oauth/hubspot/start ──────────────────────────────────────────

outcomesRouter.get('/oauth/hubspot/start', async (req: Request, res: Response): Promise<void> => {
  const parse = oauthStartSchema.safeParse(req.query);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid request', details: parse.error.flatten() });
    return;
  }

  try {
    const state = hubspotOAuth.generateState(parse.data.client_id);
    res.json({ data: { auth_url: hubspotOAuth.getAuthUrl(state), state } });
  } catch (err) {
    sendInternalError(res, err, 'GET /api/outcomes/oauth/hubspot/start');
  }
});

// ── GET /api/outcomes/oauth/hubspot/callback ───────────────────────────────────────

outcomesRouter.get('/oauth/hubspot/callback', async (req: Request, res: Response): Promise<void> => {
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
    sendInternalError(res, err, 'GET /api/outcomes/oauth/hubspot/callback');
  }
});

// ── GET /api/outcomes/oauth/salesforce/start ────────────────────────────────────────

outcomesRouter.get('/oauth/salesforce/start', async (req: Request, res: Response): Promise<void> => {
  const parse = salesforceOauthStartSchema.safeParse(req.query);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid request', details: parse.error.flatten() });
    return;
  }

  try {
    const sandbox = parse.data.sandbox ?? false;
    const state = salesforceOAuth.generateState(parse.data.client_id, sandbox);
    res.json({ data: { auth_url: salesforceOAuth.getAuthUrl(state, sandbox), state } });
  } catch (err) {
    sendInternalError(res, err, 'GET /api/outcomes/oauth/salesforce/start');
  }
});

// ── GET /api/outcomes/oauth/salesforce/callback ─────────────────────────────────────

outcomesRouter.get('/oauth/salesforce/callback', async (req: Request, res: Response): Promise<void> => {
  const parse = oauthCallbackSchema.safeParse(req.query);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid callback params', details: parse.error.flatten() });
    return;
  }

  const { code, state } = parse.data;

  try {
    const { clientId, sandbox } = salesforceOAuth.verifyState(state);
    const orgId = await resolveOrgId(req.user.id);

    const tokens = await salesforceOAuth.handleCallback(code, sandbox);
    const account = await salesforceClient.testConnection(tokens);
    const pipelines: CrmPipeline[] = await salesforceClient.listPipelines(tokens);

    const ref = await savePendingConnection({
      orgId,
      clientId: clientId ?? null,
      provider: 'salesforce',
      tokens,
      account,
      sandbox,
    });

    logger.info({ orgId, orgSfId: account.account_id, sandbox }, 'Salesforce OAuth consent granted, org discovered');

    res.json({ data: { ref, account, pipelines } });
  } catch (err) {
    if (err instanceof Error && err.message.includes('state')) {
      res.status(400).json({ error: err.message });
      return;
    }
    sendInternalError(res, err, 'GET /api/outcomes/oauth/salesforce/callback');
  }
});

// ── POST /api/outcomes/oauth/{hubspot,salesforce}/callback/finalize ────────────────
// Shared by both providers — the logic is identical once `pending` is
// resolved (pending.provider already carries which one this is).

async function finalizeConnection(req: Request, res: Response, routeLabel: string): Promise<void> {
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
          metadata: pending.provider === 'salesforce' ? { sandbox: pending.sandbox ?? false } : {},
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'organization_id,platform,account_id' },
      )
      .select('id')
      .single();

    if (insertErr || !connection) {
      throw new Error(`Failed to store ${pending.provider} connection: ${insertErr?.message}`);
    }

    logger.info({ connectionId: connection.id, orgId, provider: pending.provider }, 'CRM connection created');

    res.status(201).json({
      data: { connection_id: connection.id, account: pending.account },
    });
  } catch (err) {
    sendInternalError(res, err, routeLabel);
  }
}

outcomesRouter.post('/oauth/hubspot/callback/finalize', (req, res) => finalizeConnection(req, res, 'POST /api/outcomes/oauth/hubspot/callback/finalize'));
outcomesRouter.post('/oauth/salesforce/callback/finalize', (req, res) => finalizeConnection(req, res, 'POST /api/outcomes/oauth/salesforce/callback/finalize'));

// ── GET /api/outcomes/configs ───────────────────────────────────────────────────────

outcomesRouter.get('/configs', async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = await resolveOrgId(req.user.id);
    const configs = await listOutcomeSourceConfigsForOrg(orgId);
    res.json({ data: configs });
  } catch (err) {
    sendInternalError(res, err, 'GET /api/outcomes/configs');
  }
});

// ── POST /api/outcomes/configs ──────────────────────────────────────────────────────

outcomesRouter.post('/configs', async (req: Request, res: Response): Promise<void> => {
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
    if (connectionPlatform !== parse.data.source_type) {
      res.status(400).json({ error: `Connection platform '${connectionPlatform}' does not match provider '${parse.data.source_type}'` });
      return;
    }

    const config = await createOutcomeSourceConfig(orgId, parse.data);
    res.status(201).json({ data: config });
  } catch (err) {
    // outcome_source_configs.client_id is UNIQUE (one config per client) — Postgres's
    // own unique-violation message text, since createOutcomeSourceConfig only
    // forwards error.message, not the separate PostgrestError.code field.
    if (err instanceof Error && err.message.includes('duplicate key value violates unique constraint')) {
      res.status(409).json({ error: 'This client already has a Outcome source config.' });
      return;
    }
    sendInternalError(res, err, 'POST /api/outcomes/configs');
  }
});

// ── POST /api/outcomes/configs/webhook ──────────────────────────────────────
// Phase 3 (§6.1) — a webhook config's own creation route. The plaintext
// secret is returned ONLY in this response; every other read of this
// config (GET /configs, GET /configs/:id via listOutcomeSourceConfigsForOrg/
// getOutcomeSourceConfigById) returns webhook_secret_encrypted, never the
// plaintext — the operator must copy it now.

outcomesRouter.post('/configs/webhook', async (req: Request, res: Response): Promise<void> => {
  const parse = createWebhookConfigSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid request', details: parse.error.flatten() });
    return;
  }

  try {
    const orgId = await resolveOrgId(req.user.id);
    const secret = generateWebhookSecret();
    const config = await createWebhookOutcomeSourceConfig(orgId, parse.data, encryptWebhookSecret(secret));

    res.status(201).json({
      data: {
        ...config,
        webhook_secret: secret,
        webhook_url: `${env.BACKEND_URL}/api/outcomes/webhook/${config.id}`,
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes('duplicate key value violates unique constraint')) {
      res.status(409).json({ error: 'This client already has an Outcome source config.' });
      return;
    }
    sendInternalError(res, err, 'POST /api/outcomes/configs/webhook');
  }
});

// ── GET /api/outcomes/configs/:id/tiers ─────────────────────────────────────
// Phase 3 (§6.2) — surfaces the input-tier breakdown a client is asked to
// see: which tier their records are landing in, and (implicitly, via
// delivery_enabled/delivery_disabled_reason on the config itself, already
// returned by every other config read) what the match-rate consequence is.

outcomesRouter.get('/configs/:id/tiers', async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = await resolveOrgId(req.user.id);
    const config = await getOutcomeSourceConfigById(req.params.id, orgId);
    if (!config) {
      res.status(404).json({ error: 'Outcome source config not found' });
      return;
    }

    const methods = await getRecentIdentityMethodsForConfig(config.id);
    const stats = computeTierStats(methods);
    res.json({ data: stats });
  } catch (err) {
    sendInternalError(res, err, 'GET /api/outcomes/configs/:id/tiers');
  }
});

// ── PATCH /api/outcomes/configs/:id ─────────────────────────────────────────────────
// Per the PRD's §6.2 sequencing note ("do not proceed past a
// PROPERTIES_PRESENT_NO_DATA verdict"), turning sync_enabled on re-runs the
// readiness check server-side rather than trusting the frontend to have
// called /readiness first — a POST /readiness call the UI forgot to make
// (or a client re-pointed at a different, unwired portal after the last
// check) must not be able to slip an unready config into a real sync run.

outcomesRouter.patch('/configs/:id', async (req: Request, res: Response): Promise<void> => {
  const parse = updateConfigSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid request', details: parse.error.flatten() });
    return;
  }

  try {
    const orgId = await resolveOrgId(req.user.id);
    const existing = await getOutcomeSourceConfigById(req.params.id, orgId);
    if (!existing) {
      res.status(404).json({ error: 'Outcome source config not found' });
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

    // Phase 3 (§6.3) — an operator explicitly turning delivery back on
    // always clears the auto-disable reason; the gate itself (webhookIngest.ts)
    // is the only other writer of delivery_enabled/delivery_disabled_reason,
    // and it never goes through this route.
    const patch = parse.data.delivery_enabled === true
      ? { ...parse.data, delivery_disabled_reason: null }
      : parse.data;

    const updated = await updateOutcomeSourceConfig(req.params.id, orgId, patch);

    // Kick off the rolling sync chain on the off→on transition only — the
    // worker re-enqueues itself every sync_interval_minutes afterwards
    // (see worker.ts), so re-PATCHing sync_enabled: true while it's already
    // true must not spawn a second parallel chain.
    if (parse.data.sync_enabled === true && !existing.sync_enabled) {
      await outcomeSyncQueue.add({ config_id: updated.id });
    }

    // Attribution Chain Check PRD §8.1 — advisory only, never blocking:
    // surface a prior lead-gen chain-check result on the same off→on
    // transition, so whoever just enabled sync can see whether an earlier
    // scan found a break upstream of this connection, without hard-gating
    // on a scan that may be months stale.
    const attributionChainAdvisory = parse.data.sync_enabled === true && !existing.sync_enabled
      ? await getLatestAttributionChainForClient(existing.client_id)
      : null;

    res.json({ data: { ...updated, ...(attributionChainAdvisory ? { attribution_chain_advisory: attributionChainAdvisory } : {}) } });
  } catch (err) {
    sendInternalError(res, err, 'PATCH /api/outcomes/configs/:id');
  }
});

// ── POST /api/outcomes/configs/:id/readiness ────────────────────────────────────────

outcomesRouter.post('/configs/:id/readiness', async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = await resolveOrgId(req.user.id);
    const config = await getOutcomeSourceConfigById(req.params.id, orgId);
    if (!config) {
      res.status(404).json({ error: 'Outcome source config not found' });
      return;
    }

    const readiness = await checkReadinessForConfig(config);
    res.json({ data: readiness });
  } catch (err) {
    sendInternalError(res, err, 'POST /api/outcomes/configs/:id/readiness');
  }
});

// ── POST /api/outcomes/configs/:id/sync ─────────────────────────────────────────────
// Enqueues one immediate outcomeSyncQueue run outside the config's own rolling
// schedule — for support/testing, not a replacement for sync_enabled's
// self-re-enqueuing chain (worker.ts).

outcomesRouter.post('/configs/:id/sync', async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = await resolveOrgId(req.user.id);
    const config = await getOutcomeSourceConfigById(req.params.id, orgId);
    if (!config) {
      res.status(404).json({ error: 'Outcome source config not found' });
      return;
    }
    if (!config.sync_enabled) {
      res.status(400).json({ error: 'Sync is not enabled for this config — enable it first (PATCH sync_enabled: true).' });
      return;
    }

    await outcomeSyncQueue.add({ config_id: config.id });
    res.status(202).json({ data: { message: 'Sync run enqueued.' } });
  } catch (err) {
    sendInternalError(res, err, 'POST /api/outcomes/configs/:id/sync');
  }
});

// ── GET /api/outcomes/configs/:id/pipelines ─────────────────────────────────────────

outcomesRouter.get('/configs/:id/pipelines', async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = await resolveOrgId(req.user.id);
    const config = await getOutcomeSourceConfigById(req.params.id, orgId);
    if (!config) {
      res.status(404).json({ error: 'Outcome source config not found' });
      return;
    }

    if (!config.connection_id) {
      res.status(400).json({ error: 'This source has no connection to discover pipelines from' });
      return;
    }
    const provider = getProvider(config.source_type);
    const tokens = await resolveTokens(config.connection_id);
    const listPipelines = await requireListPipelines(provider);
    const pipelines = await listPipelines(tokens);

    res.json({ data: pipelines });
  } catch (err) {
    sendInternalError(res, err, 'GET /api/outcomes/configs/:id/pipelines');
  }
});

// ── GET /api/outcomes/configs/:id/stage-mappings ────────────────────────────────────
// Returns the saved ladder, or — when nothing has been saved yet — a
// draft built by objectMapper.ts from the connected pipeline's stages
// (is_draft: true), so StageLadderEditor always has something to render
// and the operator edits/confirms rather than starting from a blank form.

outcomesRouter.get('/configs/:id/stage-mappings', async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = await resolveOrgId(req.user.id);
    const config = await getOutcomeSourceConfigById(req.params.id, orgId);
    if (!config) {
      res.status(404).json({ error: 'Outcome source config not found' });
      return;
    }

    const saved = await listOutcomeStageMappings(config.id);

    if (saved.length > 0) {
      const counts = await countRecentOutcomesByMapping(config.id);
      const derivedByStage = config.value_mode === 'DERIVED'
        ? buildDerivedByStageMap(await getLatestDerivedValueSnapshots(config.id))
        : undefined;
      res.json({
        data: {
          is_draft: false,
          mappings: saved.map((m) => withResolvedValue({ ...m, outcomes_last_30d: counts[m.id] ?? 0 }, config, derivedByStage)),
        },
      });
      return;
    }

    if (!config.connection_id) {
      res.json({ data: { is_draft: true, mappings: [] } });
      return;
    }
    const provider = getProvider(config.source_type);
    const tokens = await resolveTokens(config.connection_id);
    const listPipelines = await requireListPipelines(provider);
    const pipelines = await listPipelines(tokens);
    const pipeline = pipelines.find((p) => p.id === config.pipeline_id) ?? pipelines[0];

    if (!pipeline) {
      res.json({ data: { is_draft: true, mappings: [] } });
      return;
    }

    const draft = buildDefaultStageMappings(pipeline).map((m) => withResolvedValue({ ...m, outcomes_last_30d: 0 }, config));
    res.json({ data: { is_draft: true, mappings: draft } });
  } catch (err) {
    sendInternalError(res, err, 'GET /api/outcomes/configs/:id/stage-mappings');
  }
});

// ── PUT /api/outcomes/configs/:id/stage-mappings ────────────────────────────────────
// Replaces the whole ladder (PRD §11) — see replaceOutcomeStageMappings()'s own
// comment for why this upserts by crm_stage_id rather than delete+reinsert.

outcomesRouter.put('/configs/:id/stage-mappings', async (req: Request, res: Response): Promise<void> => {
  const parse = replaceStageMappingsSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid request', details: parse.error.flatten() });
    return;
  }

  try {
    const orgId = await resolveOrgId(req.user.id);
    const config = await getOutcomeSourceConfigById(req.params.id, orgId);
    if (!config) {
      res.status(404).json({ error: 'Outcome source config not found' });
      return;
    }

    const mappings = await replaceOutcomeStageMappings(config.id, orgId, parse.data);
    const counts = await countRecentOutcomesByMapping(config.id);
    const derivedByStage = config.value_mode === 'DERIVED'
      ? buildDerivedByStageMap(await getLatestDerivedValueSnapshots(config.id))
      : undefined;
    res.json({
      data: {
        is_draft: false,
        mappings: mappings.map((m) => withResolvedValue({ ...m, outcomes_last_30d: counts[m.id] ?? 0 }, config, derivedByStage)),
      },
    });
  } catch (err) {
    sendInternalError(res, err, 'PUT /api/outcomes/configs/:id/stage-mappings');
  }
});

// ── GET /api/outcomes/configs/:id/derived-values ────────────────────────────────────
// Latest crm_derived_value_snapshots per stage (Sprint 7, §7.3) — whatever
// the weekly derivedValueCalculator.ts job last computed. This route never
// triggers a computation itself; a config in DECLARED mode simply has no
// rows (the calculator only ever writes for DERIVED-mode configs).

outcomesRouter.get('/configs/:id/derived-values', async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = await resolveOrgId(req.user.id);
    const config = await getOutcomeSourceConfigById(req.params.id, orgId);
    if (!config) {
      res.status(404).json({ error: 'Outcome source config not found' });
      return;
    }

    const snapshots = await getLatestDerivedValueSnapshots(config.id);
    res.json({ data: snapshots });
  } catch (err) {
    sendInternalError(res, err, 'GET /api/outcomes/configs/:id/derived-values');
  }
});

// ── GET /api/outcomes/configs/:id/outcomes ────────────────────────────────────────
// Paginated crm_outcome_events (Sprint 8, §11) — the one PRD-listed route
// that had stayed unimplemented since Sprint 5. Simple offset/limit
// pagination (crm_outcome_events volume is per-config, not the org-wide
// firehose the Signal Tracking Dashboard's cursor-based listing handles).

outcomesRouter.get('/configs/:id/outcomes', async (req: Request, res: Response): Promise<void> => {
  const parse = listOutcomesQuerySchema.safeParse(req.query);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid request', details: parse.error.flatten() });
    return;
  }

  try {
    const orgId = await resolveOrgId(req.user.id);
    const config = await getOutcomeSourceConfigById(req.params.id, orgId);
    if (!config) {
      res.status(404).json({ error: 'Outcome source config not found' });
      return;
    }

    const limit = parse.data.limit ?? 50;
    const offset = parse.data.offset ?? 0;
    const result = await listOutcomeEvents(config.id, { limit, offset, deliveryStatus: parse.data.delivery_status });
    res.json({ data: result });
  } catch (err) {
    sendInternalError(res, err, 'GET /api/outcomes/configs/:id/outcomes');
  }
});

// ── GET /api/outcomes/configs/:id/outcomes/daily ──────────────────────────────────
// Real day-grouped counts (Sprint 8, §10) — Implementation Rule 12 permits
// a chart here specifically because there is a real crm_outcome_events
// query behind it, wired below rather than fabricated.

outcomesRouter.get('/configs/:id/outcomes/daily', async (req: Request, res: Response): Promise<void> => {
  const parse = dailyOutcomesQuerySchema.safeParse(req.query);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid request', details: parse.error.flatten() });
    return;
  }

  try {
    const orgId = await resolveOrgId(req.user.id);
    const config = await getOutcomeSourceConfigById(req.params.id, orgId);
    if (!config) {
      res.status(404).json({ error: 'Outcome source config not found' });
      return;
    }

    const counts = await getDailyOutcomeCounts(config.id, parse.data.days ?? 30);
    res.json({ data: counts });
  } catch (err) {
    sendInternalError(res, err, 'GET /api/outcomes/configs/:id/outcomes/daily');
  }
});

// ── DELETE /api/outcomes/configs/:id ────────────────────────────────────────────────
// Removes the sync config only. Connection removal reuses the generic
// DELETE /api/connections/:id, per the PRD's API surface table.

outcomesRouter.delete('/configs/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = await resolveOrgId(req.user.id);
    const existing = await getOutcomeSourceConfigById(req.params.id, orgId);
    if (!existing) {
      res.status(404).json({ error: 'Outcome source config not found' });
      return;
    }

    await deleteOutcomeSourceConfig(req.params.id, orgId);
    res.json({ data: { message: 'Outcome source config removed' } });
  } catch (err) {
    sendInternalError(res, err, 'DELETE /api/outcomes/configs/:id');
  }
});

// ── Public inbound webhook — /api/outcomes/webhook (docs/prd/universal-outcome-ingestion.md §6.1) ──
//
// Deliberately a SEPARATE router, not more routes on outcomesRouter above:
// outcomesRouter.use(authMiddleware, planGuard('pro')) applies to every
// route registered on it, and an external sender (a client's own Zapier/
// Make workflow, a CRM's native webhook action) has no Atlas account to
// authenticate as. Auth here is the per-config HMAC secret instead —
// app.ts mounts this router at /api/outcomes/webhook with express.raw()
// applied first, matching the exact pattern billing.ts's Stripe webhook
// and shopifyApp.ts's webhooks already use, since HMAC verification needs
// the exact raw bytes the sender signed, not a re-serialized JSON object.
//
// Rate-limited per configId rather than per IP — a legitimate integration
// calls from its own infrastructure's IP, which a per-IP limit would
// unfairly conflate across every client using the same CRM/automation
// vendor's shared egress IPs.
export const outcomeWebhookRouter = Router();

const WEBHOOK_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const WEBHOOK_RATE_LIMIT_MAX = 60; // per config, per minute — generous for real stage-change volume

const webhookRateLimiter = rateLimit({
  windowMs: WEBHOOK_RATE_LIMIT_WINDOW_MS,
  max: WEBHOOK_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.params.configId ?? 'unknown',
  handler: (_req, res) => {
    res.status(429).json({ error: 'Too many requests for this webhook. Please slow down.' });
  },
});

interface WebhookAuthResult {
  ok: true;
  config: OutcomeSourceConfig;
  payload: unknown;
}
interface WebhookAuthFailure {
  ok: false;
  status: number;
  error: string;
}

/**
 * Shared preamble for both webhook routes below: loads the config,
 * verifies it's actually a webhook-type source with a secret, verifies the
 * HMAC signature over the raw body, and parses the body as JSON. Neither
 * route attempts delivery or persistence here — that's runWebhookIngest()'s
 * job, called separately by each route with its own dryRun flag.
 */
async function authenticateWebhookRequest(req: Request): Promise<WebhookAuthResult | WebhookAuthFailure> {
  const config = await getOutcomeSourceConfigByIdInternal(req.params.configId);
  if (!config || config.source_type !== 'webhook' || !config.webhook_secret_encrypted) {
    return { ok: false, status: 404, error: 'Webhook not found' };
  }

  const rawBody = req.body as Buffer; // express.raw() upstream (app.ts) — never express.json() for this path
  if (!Buffer.isBuffer(rawBody)) {
    return { ok: false, status: 400, error: 'Expected a raw JSON request body' };
  }

  const secret = decryptWebhookSecret(config.webhook_secret_encrypted);
  const verification = verifyWebhookRequest(
    rawBody,
    secret,
    req.header(WEBHOOK_SIGNATURE_HEADER),
    req.header(WEBHOOK_TIMESTAMP_HEADER),
  );
  if (!verification.valid) {
    return { ok: false, status: 401, error: `Signature verification failed: ${verification.reason}` };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return { ok: false, status: 400, error: 'Request body is not valid JSON' };
  }

  return { ok: true, config, payload };
}

// POST /api/outcomes/webhook/:configId — the real endpoint. Persists and,
// if delivery_enabled, attempts live delivery.
outcomeWebhookRouter.post('/:configId', webhookRateLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const auth = await authenticateWebhookRequest(req);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }

    const result = await runWebhookIngest(auth.config, auth.payload, { dryRun: false });
    const statusCode = result.status === 'rejected' ? 422 : result.status === 'skipped_duplicate' ? 200 : 202;
    res.status(statusCode).json({ data: result });
  } catch (err) {
    sendInternalError(res, err, 'POST /api/outcomes/webhook/:configId');
  }
});

// POST /api/outcomes/webhook/:configId/validate — the dry-run twin (§6.1's
// own acceptance criterion: "returns the full would-be outcome without
// delivering or persisting anything"). Same auth, same computation, zero
// side effects.
outcomeWebhookRouter.post('/:configId/validate', webhookRateLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const auth = await authenticateWebhookRequest(req);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }

    const result = await runWebhookIngest(auth.config, auth.payload, { dryRun: true });
    const statusCode = result.status === 'rejected' ? 422 : 200;
    res.status(statusCode).json({ data: result });
  } catch (err) {
    sendInternalError(res, err, 'POST /api/outcomes/webhook/:configId/validate');
  }
});
