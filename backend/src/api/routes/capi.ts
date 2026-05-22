/**
 * CAPI Module API routes — all endpoints under /api/capi
 *
 * POST   /api/capi/providers                              — create provider config
 * GET    /api/capi/providers                              — list providers for org
 * GET    /api/capi/providers/:id                          — get single provider
 * PATCH  /api/capi/providers/:id                          — update config (mappings, identifiers)
 * DELETE /api/capi/providers/:id                          — delete provider
 * POST   /api/capi/providers/:id/test                     — send test events
 * POST   /api/capi/providers/:id/activate                 — set status → active
 * GET    /api/capi/providers/:id/dashboard                — delivery analytics
 * POST   /api/capi/process                                — process a single AtlasEvent
 *
 * All routes require authMiddleware.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authMiddleware';
import { planGuard } from '../middleware/planGuard';
import { sendInternalError } from '@/utils/apiError';
import {
  createProvider,
  getProvider,
  listProviders,
  updateProviderConfig,
  updateProviderStatus,
  deleteProvider,
  getProviderDashboard,
} from '@/services/database/capiQueries';
import { safeDecryptCredentials } from '@/services/capi/credentials';
import { validateMetaCredentials, sendMetaTestEvent, formatMetaEvent } from '@/services/capi/metaDelivery';
import { validateGoogleCredentials, sendGoogleTestEvent } from '@/services/capi/googleDelivery';
import { processEvent } from '@/services/capi/pipeline';
import { setDedupEntry } from '@/services/capi/dedupStore';
import { ingestCustomerMatchBatch } from '@/services/capi/customerMatch';
import { DMAClientError } from '@/integrations/google/dmaClient';
import { supabaseAdmin } from '@/services/database/supabase';
import logger from '@/utils/logger';
import type {
  CreateProviderRequest,
  TestProviderRequest,
  AtlasEvent,
  EventMapping,
  MetaCredentials,
  GoogleCredentials,
  HashedIdentifier,
} from '@/types/capi';

export const capiRouter = Router();

// ── POST /api/capi/browser-event ──────────────────────────────────────────────
// Receives Atlas Signal Tag beacons from GTM. Authenticated via
// X-Atlas-Provider-Token header — no Supabase session required.
// Must be registered BEFORE capiRouter.use(authMiddleware).

const BrowserEventSchema = z.object({
  event_id:   z.string().uuid(),
  event_name: z.string().min(1).max(100),
  fbc:        z.string().nullable().optional(), // Meta _fbc cookie (consistent with server pipeline)
  gclid:      z.string().nullable().optional(),
  session_id: z.string().nullable().optional(),
  timestamp:  z.number().int().positive(),
  event_data: z.record(z.unknown()).optional(),
});

capiRouter.post('/browser-event', async (req: Request, res: Response): Promise<void> => {
  try {
    const token = req.headers['x-atlas-provider-token'];
    if (!token || typeof token !== 'string') {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Missing provider token' });
      return;
    }

    const { data: provider, error: providerErr } = await supabaseAdmin
      .from('capi_providers')
      .select('id, organization_id')
      .eq('provider_token', token)
      .single();

    if (providerErr || !provider) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid provider token' });
      return;
    }

    const parsed = BrowserEventSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'VALIDATION_FAILED', message: parsed.error.issues[0]?.message ?? 'Invalid request body' });
      return;
    }

    const { event_id, event_name, fbc, gclid, session_id, timestamp, event_data } = parsed.data;
    const entry = { event_id, timestamp };

    // Write to Redis for whichever click IDs are present
    const writes: Promise<void>[] = [];
    if (fbc)   writes.push(setDedupEntry('meta',   provider.id, fbc,   event_name, entry));
    if (gclid) writes.push(setDedupEntry('google', provider.id, gclid, event_name, entry));
    await Promise.all(writes);

    // Audit trail — fire-and-forget; a write failure must never surface to the beacon caller
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    void Promise.resolve(supabaseAdmin.from('capi_browser_events').insert({
      organization_id: provider.organization_id,
      provider_id:     provider.id,
      event_id,
      event_name,
      fbclid:          fbc   ?? null,
      gclid:           gclid ?? null,
      session_id:      session_id ?? null,
      event_data:      event_data && Object.keys(event_data).length > 0 ? event_data : null,
      expires_at:      expiresAt,
    })).then(({ error }) => {
      if (error) logger.warn({ err: error, event_name }, 'capi_browser_events insert failed');
    }).catch((err: unknown) => {
      logger.warn({ err, event_name }, 'capi_browser_events insert threw');
    });

    res.status(204).send();
  } catch (err) {
    // Swallow — beacon failures must be silent to the end user
    logger.warn({ err }, 'Unexpected error in /browser-event handler');
    res.status(204).send();
  }
});

// All remaining CAPI routes require auth
capiRouter.use(authMiddleware);

// ── POST /api/capi/providers ───────────────────────────────────────────────────

capiRouter.post('/providers', planGuard('pro'), async (req: Request, res: Response): Promise<void> => {
  const body = req.body as CreateProviderRequest;

  if (!body.project_id || !body.provider || !body.credentials) {
    res.status(400).json({ error: 'MISSING_FIELDS', message: 'project_id, provider, and credentials are required' });
    return;
  }

  // Validate credentials with the provider before saving
  if (body.provider === 'meta') {
    const validation = await validateMetaCredentials(body.credentials as MetaCredentials).catch(() => ({ valid: false, error: 'Validation request failed' }));
    if (!validation.valid) {
      res.status(400).json({ error: 'INVALID_CREDENTIALS', message: validation.error ?? 'Meta credential validation failed' });
      return;
    }
  } else if (body.provider === 'google') {
    const validation = await validateGoogleCredentials(body.credentials as GoogleCredentials).catch(() => ({ valid: false, error: 'Validation request failed' }));
    if (!validation.valid) {
      res.status(400).json({ error: 'INVALID_CREDENTIALS', message: validation.error ?? 'Google credential validation failed' });
      return;
    }
  }

  try {
    const bodyExt = body as CreateProviderRequest & {
      test_event_code?: string;
      data_processing_options?: string[];
      data_processing_options_country?: number;
      data_processing_options_state?: number;
      adapter_name?: string;
    };
    const provider = await createProvider({
      project_id: body.project_id,
      organization_id: req.user.id,
      provider: body.provider,
      credentials: body.credentials,
      event_mapping: body.event_mapping ?? [],
      identifier_config: body.identifier_config ?? { enabled_identifiers: [], source_mapping: {} },
      dedup_config: body.dedup_config ?? { enabled: true, event_id_field: 'event_id', dedup_window_minutes: 2880 },
      test_event_code: bodyExt.test_event_code,
      data_processing_options: bodyExt.data_processing_options,
      data_processing_options_country: bodyExt.data_processing_options_country,
      data_processing_options_state: bodyExt.data_processing_options_state,
      adapter_name: bodyExt.adapter_name,
    });

    res.status(201).json({
      id: provider.id,
      status: provider.status,
      provider: provider.provider,
      created_at: provider.created_at,
    });
  } catch (err) {
    sendInternalError(res, err, 'Failed to create CAPI provider');
  }
});

// ── GET /api/capi/providers ────────────────────────────────────────────────────

capiRouter.get('/providers', async (req: Request, res: Response): Promise<void> => {
  try {
    const providers = await listProviders(req.user.id);
    // Strip credentials from list response
    const safe = providers.map(({ ...p }) => {
      const pAny = p as Record<string, unknown>;
      delete pAny.credentials;
      return pAny;
    });
    res.json(safe);
  } catch (err) {
    sendInternalError(res, err, 'Failed to list CAPI providers');
  }
});

// ── GET /api/capi/providers/:id ────────────────────────────────────────────────

capiRouter.get('/providers/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const provider = await getProvider(req.params.id, req.user.id);
    if (!provider) { res.status(404).json({ error: 'PROVIDER_NOT_FOUND' }); return; }
    const { ...safeProvider } = provider;
    delete (safeProvider as Record<string, unknown>).credentials;
    res.json(safeProvider);
  } catch (err) {
    sendInternalError(res, err, 'Failed to get CAPI provider');
  }
});

// ── PATCH /api/capi/providers/:id ─────────────────────────────────────────────

capiRouter.patch('/providers/:id', async (req: Request, res: Response): Promise<void> => {
  const { event_mapping, identifier_config, dedup_config, test_event_code, data_processing_options, data_processing_options_country, data_processing_options_state } = req.body as Partial<{
    event_mapping: EventMapping[];
    identifier_config: unknown;
    dedup_config: unknown;
    test_event_code: string;
    data_processing_options: string[];
    data_processing_options_country: number;
    data_processing_options_state: number;
  }>;

  try {
    const existing = await getProvider(req.params.id, req.user.id);
    if (!existing) { res.status(404).json({ error: 'PROVIDER_NOT_FOUND' }); return; }

    const updated = await updateProviderConfig(req.params.id, {
      ...(event_mapping !== undefined && { event_mapping }),
      ...(identifier_config !== undefined && { identifier_config: identifier_config as never }),
      ...(dedup_config !== undefined && { dedup_config: dedup_config as never }),
      ...(test_event_code !== undefined && { test_event_code }),
      ...(data_processing_options !== undefined && { data_processing_options }),
      ...(data_processing_options_country !== undefined && { data_processing_options_country }),
      ...(data_processing_options_state !== undefined && { data_processing_options_state }),
    });

    const { ...safeUpdated } = updated;
    delete (safeUpdated as Record<string, unknown>).credentials;
    res.json(safeUpdated);
  } catch (err) {
    sendInternalError(res, err, 'Failed to update CAPI provider');
  }
});

// ── DELETE /api/capi/providers/:id ────────────────────────────────────────────

capiRouter.delete('/providers/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const existing = await getProvider(req.params.id, req.user.id);
    if (!existing) { res.status(404).json({ error: 'PROVIDER_NOT_FOUND' }); return; }
    await deleteProvider(req.params.id, req.user.id);
    res.json({ deleted: true });
  } catch (err) {
    sendInternalError(res, err, 'Failed to delete CAPI provider');
  }
});

// ── POST /api/capi/providers/:id/test ─────────────────────────────────────────

capiRouter.post('/providers/:id/test', async (req: Request, res: Response): Promise<void> => {
  const body = req.body as TestProviderRequest;

  if (!body.test_events || body.test_events.length === 0) {
    res.status(400).json({ error: 'MISSING_FIELDS', message: 'test_events array is required' });
    return;
  }

  try {
    const provider = await getProvider(req.params.id, req.user.id);
    if (!provider) { res.status(404).json({ error: 'PROVIDER_NOT_FOUND' }); return; }

    if (provider.provider === 'meta' && !provider.test_event_code) {
      res.status(400).json({ error: 'VALIDATION_FAILED', message: 'test_event_code must be set before testing' });
      return;
    }

    const creds = safeDecryptCredentials(provider.credentials);
    const results = await Promise.all(
      body.test_events.map(async (event: AtlasEvent) => {
        const mapping = provider.event_mapping.find(m => m.atlas_event === event.event_name)
          ?? { atlas_event: event.event_name, provider_event: event.event_name };

        if (provider.provider === 'meta') {
          const result = await sendMetaTestEvent(event, [], mapping, creds as MetaCredentials, provider.test_event_code!);
          return { event_name: event.event_name, ...result };
        }
        if (provider.provider === 'google') {
          const result = await sendGoogleTestEvent(event, [], mapping, creds as GoogleCredentials);
          return { event_name: event.event_name, ...result };
        }
        return { event_name: event.event_name, status: 'failed' as const, provider_response: null, error: 'Provider not supported for testing yet' };
      })
    );

    // Mark provider as 'testing' on first successful test
    if (results.some(r => r.status === 'success') && provider.status === 'draft') {
      await updateProviderStatus(req.params.id, 'testing');
    }

    res.json({ results });
  } catch (err) {
    sendInternalError(res, err, 'Failed to test CAPI provider');
  }
});

// ── POST /api/capi/providers/:id/activate ─────────────────────────────────────

capiRouter.post('/providers/:id/activate', async (req: Request, res: Response): Promise<void> => {
  try {
    const provider = await getProvider(req.params.id, req.user.id);
    if (!provider) { res.status(404).json({ error: 'PROVIDER_NOT_FOUND' }); return; }

    if (provider.event_mapping.length === 0) {
      res.status(400).json({ error: 'VALIDATION_FAILED', message: 'At least one event mapping is required before activation' });
      return;
    }

    await updateProviderStatus(req.params.id, 'active');
    res.json({ id: req.params.id, status: 'active', activated_at: new Date().toISOString() });
  } catch (err) {
    sendInternalError(res, err, 'Failed to activate CAPI provider');
  }
});

// ── POST /api/capi/providers/:id/reconnect ────────────────────────────────────
// Resets a provider in 'reconnect_required' state back to 'draft' so the user
// can update their credentials and go through the setup wizard again.

capiRouter.post('/providers/:id/reconnect', async (req: Request, res: Response): Promise<void> => {
  try {
    const provider = await getProvider(req.params.id, req.user.id);
    if (!provider) { res.status(404).json({ error: 'PROVIDER_NOT_FOUND' }); return; }

    if (provider.status !== 'reconnect_required') {
      res.status(400).json({ error: 'VALIDATION_FAILED', message: `Provider status is '${provider.status}' — reconnect is only needed when status is 'reconnect_required'` });
      return;
    }

    await updateProviderStatus(req.params.id, 'draft', null);
    res.json({ id: req.params.id, status: 'draft', message: 'Provider reset to draft. Update your credentials to reconnect.' });
  } catch (err) {
    sendInternalError(res, err, 'Failed to reconnect CAPI provider');
  }
});

// ── GET /api/capi/providers/:id/dashboard ─────────────────────────────────────

capiRouter.get('/providers/:id/dashboard', async (req: Request, res: Response): Promise<void> => {
  const days = parseInt(String(req.query.days ?? '30'), 10);

  try {
    const provider = await getProvider(req.params.id, req.user.id);
    if (!provider) { res.status(404).json({ error: 'PROVIDER_NOT_FOUND' }); return; }

    const dashboard = await getProviderDashboard(req.params.id, req.user.id, days);
    res.json(dashboard);
  } catch (err) {
    sendInternalError(res, err, 'Failed to get CAPI dashboard');
  }
});

// ── POST /api/capi/process ────────────────────────────────────────────────────
// Process a single AtlasEvent through the pipeline for a given provider.

capiRouter.post('/process', async (req: Request, res: Response): Promise<void> => {
  const { provider_id, event } = req.body as { provider_id: string; event: AtlasEvent };

  if (!provider_id || !event) {
    res.status(400).json({ error: 'MISSING_FIELDS', message: 'provider_id and event are required' });
    return;
  }

  try {
    const provider = await getProvider(provider_id, req.user.id);
    if (!provider) { res.status(404).json({ error: 'PROVIDER_NOT_FOUND' }); return; }
    if (provider.status !== 'active') {
      res.status(400).json({ error: 'PROVIDER_NOT_ACTIVE', message: `Provider is ${provider.status}` });
      return;
    }

    const result = await processEvent(event, provider);
    res.json(result);
  } catch (err) {
    sendInternalError(res, err, 'Failed to process CAPI event');
  }
});

// ── POST /api/capi/google/audience ────────────────────────────────────────────
// Upload a Customer Match audience batch to Google Ads via the DMA API.

const AudienceUploadSchema = z.object({
  customer_id: z.string().min(1),
  contacts: z.array(
    z.object({
      email: z.string().optional(),
      phone: z.string().optional(),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      zip: z.string().optional(),
      country: z.string().optional(),
    }),
  ).min(1).max(500_000),
  operation_type: z.enum(['CREATE', 'REMOVE']).default('CREATE'),
});

capiRouter.post('/google/audience', async (req: Request, res: Response): Promise<void> => {
  const parsed = AudienceUploadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'VALIDATION_FAILED',
      message: parsed.error.issues[0]?.message ?? 'Invalid request body',
    });
    return;
  }

  const { customer_id, contacts, operation_type } = parsed.data;

  try {
    const result = await ingestCustomerMatchBatch(req.user.id, customer_id, contacts, operation_type);

    const { data: insertedRow, error: insertErr } = await supabaseAdmin
      .from('audience_member_uploads')
      .insert({
        org_id: req.user.id,
        customer_id,
        operation_type,
        status: 'completed',
        record_count: result.record_count,
        matched_count: result.matched_count,
        failed_count: result.failed_count,
        dma_response: result.raw_response as Record<string, unknown>,
      })
      .select('id')
      .single();

    if (insertErr || !insertedRow) {
      logger.warn({ err: insertErr?.message }, 'Failed to persist audience_member_uploads row');
    }

    res.json({
      data: {
        id: insertedRow?.id ?? null,
        record_count: result.record_count,
        matched_count: result.matched_count,
        failed_count: result.failed_count,
        member_errors: result.member_errors,
      },
    });
  } catch (err) {
    if (err instanceof DMAClientError && err.status === 401) {
      res.status(400).json({
        error: 'DMA_NOT_CONNECTED',
        message: 'Connect Google Ads via Platform Connections to use audience uploads.',
      });
      return;
    }
    sendInternalError(res, err, 'Failed to ingest Customer Match audience');
  }
});

// ── GET /api/capi/google/audience ─────────────────────────────────────────────
// Returns the last 20 Customer Match upload records for the authenticated org.

capiRouter.get('/google/audience', async (req: Request, res: Response): Promise<void> => {
  try {
    const { data: uploads, error } = await supabaseAdmin
      .from('audience_member_uploads')
      .select('id, operation_type, status, record_count, matched_count, failed_count, error_message, created_at')
      .eq('org_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      sendInternalError(res, error, 'Failed to fetch audience uploads');
      return;
    }

    res.json({ data: uploads ?? [] });
  } catch (err) {
    sendInternalError(res, err, 'Failed to fetch audience uploads');
  }
});
