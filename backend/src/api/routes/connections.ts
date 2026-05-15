/**
 * Platform Reconciliation — Connection Management routes
 *
 * GET    /api/connections                              — list all connections for org
 * GET    /api/connections/oauth/:platform/start        — initiate OAuth, returns auth URL
 * GET    /api/connections/oauth/:platform/callback     — OAuth callback (browser redirect)
 * POST   /api/connections/:id/discover                 — re-enumerate under a manager
 * POST   /api/connections/:id/connect                  — flip available → active
 * POST   /api/connections/:id/disconnect               — flip active → available
 * DELETE /api/connections/:id                          — full remove (manager cascades)
 * POST   /api/connections/:id/test                     — live platform test
 * POST   /api/connections/:id/sync                     — Phase 2 placeholder
 *
 * All routes (except the OAuth callback redirect) require authMiddleware + planGuard('pro').
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authMiddleware';
import { planGuard } from '../middleware/planGuard';
import { sendInternalError } from '@/utils/apiError';
import {
  initiateOAuth,
  handleOAuthCallback,
  connectAccount,
  disconnectAccount,
  rediscoverAccounts,
  removeConnection,
} from '@/services/connections/connectionLifecycle';
import { testConnection } from '@/services/connections/connectionTester';
import { listConnectionsForOrg } from '@/services/database/connectionQueries';
import type {
  Platform,
  ConnectionsResponse,
  PlatformConnectionPublic,
  ConnectionGroup,
} from '@/types/connections';

export const connectionsRouter = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

async function resolveOrgId(userId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('organization_id')
    .eq('id', userId)
    .single();
  return (data as { organization_id: string } | null)?.organization_id ?? userId;
}

const PLATFORMS: Platform[] = ['google_ads', 'meta', 'ga4', 'gtm_destinations'];

function isValidPlatform(p: string): p is Platform {
  return PLATFORMS.includes(p as Platform);
}

// Groups a flat list of connections into the nested ConnectionsResponse shape
function groupConnections(flat: PlatformConnectionPublic[]): ConnectionsResponse {
  const managerGroups = new Map<string, ConnectionGroup>();
  const standalones: PlatformConnectionPublic[] = [];
  const ga4Standalones: PlatformConnectionPublic[] = [];

  // First pass: seed manager rows
  for (const conn of flat) {
    if (conn.connection_type === 'manager') {
      managerGroups.set(conn.id, { manager: conn, children: [] });
    }
  }

  // Second pass: attach children and collect standalones
  for (const conn of flat) {
    if (conn.connection_type === 'child') {
      const group = conn.parent_connection_id
        ? managerGroups.get(conn.parent_connection_id)
        : undefined;
      if (group) group.children.push(conn);
    } else if (conn.connection_type === 'standalone') {
      if (conn.platform === 'ga4') {
        ga4Standalones.push(conn);
      } else {
        standalones.push(conn);
      }
    }
  }

  const googleAdsGroups = [...managerGroups.values()].filter(
    (g) => g.manager.platform === 'google_ads',
  );
  const metaGroups = [...managerGroups.values()].filter(
    (g) => g.manager.platform === 'meta',
  );
  const gtmGroups = [...managerGroups.values()].filter(
    (g) => g.manager.platform === 'gtm_destinations',
  );

  return {
    google_ads: googleAdsGroups,
    meta: metaGroups,
    ga4: ga4Standalones,
    gtm_destinations: gtmGroups,
    standalone: standalones,
  };
}

// ── Zod schemas ───────────────────────────────────────────────────────────────

const ConnectBody = z.object({ clientId: z.string().uuid('clientId must be a valid UUID') });
const RemoveBody = z.object({ confirmed: z.literal(true, { errorMap: () => ({ message: 'confirmed must be true' }) }) });

// ── Auth middleware on all routes ─────────────────────────────────────────────

connectionsRouter.use(authMiddleware);

// ── GET /api/connections ──────────────────────────────────────────────────────

connectionsRouter.get('/', planGuard('pro'), async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = await resolveOrgId(req.user.id);
    const flat = await listConnectionsForOrg(orgId);
    res.json({ data: groupConnections(flat) });
  } catch (err) {
    sendInternalError(res, err, 'GET /api/connections');
  }
});

// ── GET /api/connections/oauth/:platform/start ────────────────────────────────

connectionsRouter.get(
  '/oauth/:platform/start',
  planGuard('pro'),
  async (req: Request, res: Response): Promise<void> => {
    const { platform } = req.params;
    if (!isValidPlatform(platform)) {
      res.status(400).json({ error: `Invalid platform: ${platform}` });
      return;
    }

    const clientId = req.query.clientId as string | undefined;

    try {
      const { authUrl, state } = initiateOAuth(platform as Platform, clientId);
      res.json({ data: { authUrl, state } });
    } catch (err) {
      sendInternalError(res, err, 'GET /api/connections/oauth/start');
    }
  },
);

// ── POST /api/connections/oauth/:platform/callback ────────────────────────────
// Called by the frontend SPA callback page after the platform redirects back.
// The browser lands on /connections/oauth/:platform/callback (a frontend route),
// which reads code+state from the URL and calls this authenticated endpoint.
// This avoids any cookie dependency — the Supabase auth token travels in the
// Authorization header as usual.

const OAuthCallbackBody = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

connectionsRouter.post(
  '/oauth/:platform/callback',
  planGuard('pro'),
  async (req: Request, res: Response): Promise<void> => {
    const { platform } = req.params;
    if (!isValidPlatform(platform)) {
      res.status(400).json({ error: `Invalid platform: ${platform}` });
      return;
    }

    const parsed = OAuthCallbackBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }

    try {
      const orgId = await resolveOrgId(req.user.id);
      const result = await handleOAuthCallback(
        platform as Platform,
        parsed.data.code,
        parsed.data.state,
        orgId,
      );
      res.json({
        data: {
          managerId: result.managerId,
          discovered: result.discovered,
          standaloneDiscovered: result.standaloneDiscovered ?? [],
        },
        message: `Discovered ${result.discovered.length} account(s)`,
      });
    } catch (err) {
      if (err instanceof Error && err.message.includes('HMAC')) {
        res.status(400).json({ error: 'Invalid OAuth state — please try connecting again' });
        return;
      }
      if (err instanceof Error && err.message.includes('expired')) {
        res.status(400).json({ error: err.message });
        return;
      }
      sendInternalError(res, err, 'POST /api/connections/oauth/:platform/callback');
    }
  },
);

// ── POST /api/connections/:id/discover ────────────────────────────────────────

connectionsRouter.post(
  '/:id/discover',
  planGuard('pro'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const orgId = await resolveOrgId(req.user.id);
      const discovered = await rediscoverAccounts(req.params.id, orgId);
      res.json({ data: discovered, message: `Discovered ${discovered.length} account(s)` });
    } catch (err) {
      if (err instanceof Error && err.message.includes('not found')) {
        res.status(404).json({ error: err.message });
        return;
      }
      sendInternalError(res, err, 'POST /api/connections/:id/discover');
    }
  },
);

// ── POST /api/connections/:id/connect ─────────────────────────────────────────

connectionsRouter.post(
  '/:id/connect',
  planGuard('pro'),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = ConnectBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }

    try {
      const orgId = await resolveOrgId(req.user.id);
      const connection = await connectAccount(req.params.id, parsed.data.clientId, orgId);
      res.json({ data: connection, message: 'Account connected' });
    } catch (err) {
      if (err instanceof Error && err.message.includes('not found')) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof Error && err.message.includes("not in 'available'")) {
        res.status(409).json({ error: err.message });
        return;
      }
      sendInternalError(res, err, 'POST /api/connections/:id/connect');
    }
  },
);

// ── POST /api/connections/:id/disconnect ──────────────────────────────────────

connectionsRouter.post(
  '/:id/disconnect',
  planGuard('pro'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const orgId = await resolveOrgId(req.user.id);
      await disconnectAccount(req.params.id, orgId);
      res.json({ message: 'Account disconnected' });
    } catch (err) {
      if (err instanceof Error && err.message.includes('not found')) {
        res.status(404).json({ error: err.message });
        return;
      }
      sendInternalError(res, err, 'POST /api/connections/:id/disconnect');
    }
  },
);

// ── DELETE /api/connections/:id ───────────────────────────────────────────────

connectionsRouter.delete(
  '/:id',
  planGuard('pro'),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = RemoveBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'confirmed must be true to remove a connection' });
      return;
    }

    try {
      const orgId = await resolveOrgId(req.user.id);
      await removeConnection(req.params.id, orgId, true);
      res.json({ message: 'Connection removed' });
    } catch (err) {
      if (err instanceof Error && err.message.includes('not found')) {
        res.status(404).json({ error: err.message });
        return;
      }
      sendInternalError(res, err, 'DELETE /api/connections/:id');
    }
  },
);

// ── POST /api/connections/:id/test ────────────────────────────────────────────

connectionsRouter.post(
  '/:id/test',
  planGuard('pro'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const orgId = await resolveOrgId(req.user.id);
      const result = await testConnection(req.params.id, orgId);
      res.json({ data: result });
    } catch (err) {
      sendInternalError(res, err, 'POST /api/connections/:id/test');
    }
  },
);

// ── POST /api/connections/:id/sync ────────────────────────────────────────────
// Phase 2 placeholder — sync workers not yet implemented

connectionsRouter.post(
  '/:id/sync',
  planGuard('pro'),
  async (_req: Request, res: Response): Promise<void> => {
    res.status(501).json({ message: 'Sync available in Phase 2' });
  },
);
