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
import { authMiddleware } from '../middleware/authMiddleware';
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

// All CAPI routes require auth
capiRouter.use(authMiddleware);

// ── POST /api/capi/providers ───────────────────────────────────────────────────

capiRouter.post('/providers', async (req: Request, res: Response): Promise<void> => {
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
    const provider = await createProvider({
      project_id: body.project_id,
      organization_id: req.user.id,
      provider: body.provider,
      credentials: body.credentials,
      event_mapping: body.event_mapping ?? [],
      identifier_config: body.identifier_config ?? { enabled_identifiers: [], source_mapping: {} },
      dedup_config: body.dedup_config ?? { enabled: true, event_id_field: 'event_id', dedup_window_minutes: 2880 },
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
  const { event_mapping, identifier_config, dedup_config, test_event_code } = req.body as Partial<{
    event_mapping: EventMapping[];
    identifier_config: unknown;
    dedup_config: unknown;
    test_event_code: string;
  }>;

  try {
    const existing = await getProvider(req.params.id, req.user.id);
    if (!existing) { res.status(404).json({ error: 'PROVIDER_NOT_FOUND' }); return; }

    const updated = await updateProviderConfig(req.params.id, {
      ...(event_mapping !== undefined && { event_mapping }),
      ...(identifier_config !== undefined && { identifier_config: identifier_config as never }),
      ...(dedup_config !== undefined && { dedup_config: dedup_config as never }),
      ...(test_event_code !== undefined && { test_event_code }),
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
