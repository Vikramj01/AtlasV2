/**
 * Google tag gateway routes (docs/prd/google-tag-gateway.md §9).
 *
 * Mounted at /api/organisations like every other client route (the PRD's literal
 * /api/clients/:id/gtg path does not exist in this codebase; same call the
 * Google Tag Topology routes made). A separate router from clients.ts so it is
 * testable without that file's import chain.
 *
 *   GET    /:orgId/clients/:clientId/gtg                       status, endpoints, recent checks
 *   POST   /:orgId/clients/:clientId/gtg/endpoints             operator add / correct a path
 *   DELETE /:orgId/clients/:clientId/gtg/endpoints/:endpointId remove a wrong path
 *   POST   /:orgId/clients/:clientId/gtg/verify                on-demand probe
 *
 * Reading, registering and verifying are open to every plan (PRD D5): only the
 * generated CDN configuration (Sprint 4) is tier-gated.
 */
import { Router } from 'express';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { authMiddleware } from '@/api/middleware/authMiddleware';
import { orgMiddleware } from '@/api/middleware/orgMiddleware';
import { sendInternalError } from '@/utils/apiError';
import { validateUrl } from '@/utils/urlValidator';
import { getClient } from '@/services/database/clientQueries';
import {
  applyProbeStatus,
  deleteEndpoint,
  listEndpointsForClient,
  listRecentGtgChecks,
  upsertOperatorEndpoint,
} from '@/services/database/gtgQueries';
import { endpointProbeUrls, normaliseHostname, validateEndpointInput, MAX_ENDPOINTS_PER_CLIENT } from '@/services/gtg/gtgEndpoints';
import { normaliseGtgStatus, normaliseProbeSummary, effectiveProbeSummary } from '@/services/gtg/gtgStatus';
import { runGtgChecks } from '@/services/dqm/gtgGatewayMonitor';

const router = Router({ mergeParams: true });
router.use(authMiddleware);
router.use('/:orgId/clients', orgMiddleware);

const VERIFY_COOLDOWN_MS = 10_000;
const lastVerifyAt = new Map<string, number>();

/** Test seam: the cooldown is per process, so tests reset it between cases. */
export function resetGtgVerifyThrottle(): void {
  lastVerifyAt.clear();
}

interface ClientGtgFields {
  website_url: string;
  gtg_status?: unknown;
  gtg_status_updated_at?: string | null;
  gtg_went_live_at?: string | null;
  gtg_capture_status?: unknown;
  gtg_probe_status?: unknown;
  gtg_probe_checked_at?: string | null;
}

const ok = (data: unknown, message = 'ok') => ({ data, error: null, message });
const fail = (error: string, message = error) => ({ data: null, error, message });

function clientHostname(websiteUrl: string): string {
  return normaliseHostname(websiteUrl) ?? websiteUrl;
}

async function loadClient(req: Request): Promise<(ClientGtgFields & { id: string }) | null> {
  const client = await getClient(req.params['clientId'], req.params['orgId']);
  return client ? (client as unknown as ClientGtgFields & { id: string }) : null;
}

function statusPayload(c: ClientGtgFields) {
  const probe = normaliseProbeSummary(c.gtg_probe_status);
  return {
    status: normaliseGtgStatus(c.gtg_status),
    status_updated_at: c.gtg_status_updated_at ?? null,
    went_live_at: c.gtg_went_live_at ?? null,
    capture_status: normaliseGtgStatus(c.gtg_capture_status),
    probe_status: effectiveProbeSummary(probe, c.gtg_probe_checked_at ?? null),
    probe_checked_at: c.gtg_probe_checked_at ?? null,
  };
}

router.get('/:orgId/clients/:clientId/gtg', async (req: Request, res: Response) => {
  try {
    const client = await loadClient(req);
    if (!client) return res.status(404).json(fail('Client not found'));

    const [endpoints, recent] = await Promise.all([
      listEndpointsForClient(req.params['clientId']),
      listRecentGtgChecks(req.params['clientId']).catch(() => []),
    ]);
    res.json(ok({
      ...statusPayload(client),
      endpoints: endpoints.map((e) => ({ ...e, probe_urls: endpointProbeUrls(e) })),
      recent_checks: recent,
      max_endpoints: MAX_ENDPOINTS_PER_CLIENT,
    }));
  } catch (err) {
    sendInternalError(res, err);
  }
});

const endpointBodySchema = z.object({
  hostname: z.string().trim().min(1).max(253),
  reserved_path: z.string().trim().min(1).max(120),
  tag_or_container: z.string().trim().min(1).max(32),
});

router.post('/:orgId/clients/:clientId/gtg/endpoints', async (req: Request, res: Response) => {
  try {
    const parsed = endpointBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(fail('Invalid request', parsed.error.issues.map((i) => i.message).join('; ')));
    }
    const client = await loadClient(req);
    if (!client) return res.status(404).json(fail('Client not found'));

    const v = validateEndpointInput(parsed.data, clientHostname(client.website_url));
    if (!v.ok) return res.status(400).json(fail('Invalid endpoint', v.error));

    // Atlas will send requests to this host: reject anything the SSRF guard rejects.
    const guard = validateUrl(endpointProbeUrls(v.value).healthy);
    if (!guard.valid) return res.status(400).json(fail('Invalid endpoint', guard.error ?? 'Hostname rejected'));

    const endpoint = await upsertOperatorEndpoint(req.params['orgId'], req.params['clientId'], v.value);
    res.status(201).json(ok({ ...endpoint, probe_urls: endpointProbeUrls(endpoint) }, 'Endpoint saved. Run a verification to check it.'));
  } catch (err) {
    if (err instanceof Error && /at most \d+ gateway paths/.test(err.message)) {
      return res.status(400).json(fail('Too many endpoints', err.message));
    }
    sendInternalError(res, err);
  }
});

router.delete('/:orgId/clients/:clientId/gtg/endpoints/:endpointId', async (req: Request, res: Response) => {
  try {
    const client = await loadClient(req);
    if (!client) return res.status(404).json(fail('Client not found'));

    const removed = await deleteEndpoint(req.params['clientId'], req.params['endpointId']);
    if (!removed) return res.status(404).json(fail('Endpoint not found'));

    // With no registered path left there is nothing to probe: drop the stale probe result so the
    // status falls back to what the page itself shows.
    const remaining = await listEndpointsForClient(req.params['clientId']);
    if (remaining.length === 0) await applyProbeStatus(req.params['clientId'], 'none');

    res.json(ok({ removed: true }, 'Endpoint removed'));
  } catch (err) {
    sendInternalError(res, err);
  }
});

router.post('/:orgId/clients/:clientId/gtg/verify', async (req: Request, res: Response) => {
  try {
    const client = await loadClient(req);
    if (!client) return res.status(404).json(fail('Client not found'));

    const key = `${req.params['orgId']}:${req.params['clientId']}`;
    const now = Date.now();
    if (now - (lastVerifyAt.get(key) ?? 0) < VERIFY_COOLDOWN_MS) {
      return res.status(429).json(fail('Please wait a few seconds before verifying again'));
    }

    const endpoints = await listEndpointsForClient(req.params['clientId']);
    if (endpoints.length === 0) {
      return res.status(422).json(fail('No gateway path registered', 'Add the path your CDN routes to the gateway first.'));
    }
    lastVerifyAt.set(key, now);

    const run = await runGtgChecks(req.params['orgId'], 2000, { clientId: req.params['clientId'] });
    const fresh = (await loadClient(req)) ?? client;

    res.json(ok({
      ...statusPayload(fresh),
      results: run.results.map((r) => ({
        endpoint_id: r.endpointId,
        path_status: r.pathStatus,
        geo_status: r.geoStatus,
        verdict: r.verdict,
        http_status: r.httpStatus,
        response_ms: r.responseMs,
        message: r.errorMessage,
      })),
    }));
  } catch (err) {
    sendInternalError(res, err);
  }
});

export { router as gtgRouter };
