/**
 * Signal Library routes
 *
 * /api/signals        — individual signal CRUD (system + org custom)
 * /api/signal-packs   — pack CRUD (system + org custom)
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { authMiddleware } from '@/api/middleware/authMiddleware';
import { sendInternalError } from '@/utils/apiError';
import { getOrgMembership } from '@/services/database/orgQueries';
import {
  listSignals,
  getSignal,
  createSignal,
  updateSignal,
  deleteSignal,
  listSignalPacks,
  getSignalPack,
  getSignalPackWithSignals,
  createSignalPack,
  updateSignalPack,
  deleteSignalPack,
  addSignalToPack,
  removeSignalFromPack,
  countClientsUsingPack,
  countOutdatedDeployments,
  incrementPackVersion,
} from '@/services/database/signalQueries';
import { getClientsByPack, getClient } from '@/services/database/clientQueries';
import { generateComposableOutputs } from '@/services/signals/composableOutputGenerator';
import type { CreateSignalRequest, UpdateSignalRequest, CreatePackRequest } from '@/types/signal';

const router = Router();
router.use(authMiddleware);

// ─── Helper: verify user belongs to org ───────────────────────────────────────

async function assertOrgMember(orgId: string, userId: string, res: Response): Promise<boolean> {
  const m = await getOrgMembership(orgId, userId);
  if (!m) {
    res.status(403).json({ error: 'Not a member of this organisation' });
    return false;
  }
  return true;
}

// ══════════════════════════════════════════════════════════════════════════════
// SIGNALS
// ══════════════════════════════════════════════════════════════════════════════

// ── GET /api/signals ──────────────────────────────────────────────────────────
// Returns system signals + org's custom signals when ?org_id= is provided.

router.get('/', async (req: Request, res: Response) => {
  try {
    const orgId = req.query['org_id'] as string | undefined;
    if (orgId && !(await assertOrgMember(orgId, req.user!.id, res))) return;

    const signals = await listSignals(orgId);
    res.json({ signals });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── POST /api/signals ─────────────────────────────────────────────────────────

router.post('/', async (req: Request, res: Response) => {
  try {
    const body = req.body as CreateSignalRequest;
    if (!body.organisation_id || !body.key || !body.name || !body.description || !body.category) {
      return res.status(400).json({ error: 'organisation_id, key, name, description, and category are required' });
    }
    if (!(await assertOrgMember(body.organisation_id, req.user!.id, res))) return;

    const signal = await createSignal(body);
    res.status(201).json(signal);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('unique')) return res.status(409).json({ error: 'A signal with that key already exists in your organisation' });
    sendInternalError(res, err);
  }
});

// ── GET /api/signals/:signalId ────────────────────────────────────────────────

router.get('/:signalId', async (req: Request, res: Response) => {
  try {
    const signal = await getSignal(req.params['signalId']);
    if (!signal) return res.status(404).json({ error: 'Signal not found' });
    res.json(signal);
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── PUT /api/signals/:signalId ────────────────────────────────────────────────

router.put('/:signalId', async (req: Request, res: Response) => {
  try {
    const signal = await getSignal(req.params['signalId']);
    if (!signal) return res.status(404).json({ error: 'Signal not found' });
    if (signal.is_system) return res.status(403).json({ error: 'System signals cannot be modified' });
    if (!signal.organisation_id) return res.status(403).json({ error: 'Cannot modify this signal' });

    if (!(await assertOrgMember(signal.organisation_id, req.user!.id, res))) return;

    const updated = await updateSignal(req.params['signalId'], signal.organisation_id, req.body as UpdateSignalRequest);
    res.json(updated);
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── DELETE /api/signals/:signalId ─────────────────────────────────────────────

router.delete('/:signalId', async (req: Request, res: Response) => {
  try {
    const signal = await getSignal(req.params['signalId']);
    if (!signal) return res.status(404).json({ error: 'Signal not found' });
    if (signal.is_system) return res.status(403).json({ error: 'System signals cannot be deleted' });
    if (!signal.organisation_id) return res.status(403).json({ error: 'Cannot delete this signal' });

    if (!(await assertOrgMember(signal.organisation_id, req.user!.id, res))) return;

    await deleteSignal(req.params['signalId'], signal.organisation_id);
    res.json({ deleted: true });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// SIGNAL PACKS
// ══════════════════════════════════════════════════════════════════════════════

// ── GET /api/signal-packs ─────────────────────────────────────────────────────

router.get('/packs', async (req: Request, res: Response) => {
  try {
    const orgId = req.query['org_id'] as string | undefined;
    if (orgId && !(await assertOrgMember(orgId, req.user!.id, res))) return;

    const packs = await listSignalPacks(orgId);
    res.json({ packs });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── POST /api/signal-packs ────────────────────────────────────────────────────

router.post('/packs', async (req: Request, res: Response) => {
  try {
    const body = req.body as CreatePackRequest;
    if (!body.name || !body.business_type) {
      return res.status(400).json({ error: 'name and business_type are required' });
    }
    if (body.organisation_id && !(await assertOrgMember(body.organisation_id, req.user!.id, res))) return;

    const pack = await createSignalPack(body);
    res.status(201).json(pack);
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── GET /api/signal-packs/:packId ─────────────────────────────────────────────

router.get('/packs/:packId', async (req: Request, res: Response) => {
  try {
    const pack = await getSignalPackWithSignals(req.params['packId']);
    if (!pack) return res.status(404).json({ error: 'Signal pack not found' });

    const [clientCount, outdatedCount] = await Promise.all([
      countClientsUsingPack(req.params['packId']),
      countOutdatedDeployments(req.params['packId']),
    ]);
    res.json({ ...pack, client_count: clientCount, outdated_count: outdatedCount });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── PUT /api/signal-packs/:packId ─────────────────────────────────────────────

router.put('/packs/:packId', async (req: Request, res: Response) => {
  try {
    const pack = await getSignalPack(req.params['packId']);
    if (!pack) return res.status(404).json({ error: 'Signal pack not found' });
    if (pack.is_system) return res.status(403).json({ error: 'System packs cannot be modified directly. Clone the pack to customise it.' });
    if (!pack.organisation_id) return res.status(403).json({ error: 'Cannot modify this pack' });

    if (!(await assertOrgMember(pack.organisation_id, req.user!.id, res))) return;

    const updated = await updateSignalPack(req.params['packId'], pack.organisation_id, req.body as Partial<CreatePackRequest>);
    await incrementPackVersion(req.params['packId']);
    res.json(updated);
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── DELETE /api/signal-packs/:packId ─────────────────────────────────────────

router.delete('/packs/:packId', async (req: Request, res: Response) => {
  try {
    const pack = await getSignalPack(req.params['packId']);
    if (!pack) return res.status(404).json({ error: 'Signal pack not found' });
    if (pack.is_system) return res.status(403).json({ error: 'System packs cannot be deleted' });
    if (!pack.organisation_id) return res.status(403).json({ error: 'Cannot delete this pack' });

    if (!(await assertOrgMember(pack.organisation_id, req.user!.id, res))) return;

    const clientCount = await countClientsUsingPack(req.params['packId']);
    if (clientCount > 0) {
      return res.status(409).json({ error: `Cannot delete pack: ${clientCount} client(s) have it deployed. Remove all deployments first.` });
    }

    await deleteSignalPack(req.params['packId'], pack.organisation_id);
    res.json({ deleted: true });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── POST /api/signal-packs/:packId/signals ────────────────────────────────────

router.post('/packs/:packId/signals', async (req: Request, res: Response) => {
  try {
    const { signal_id, stage_hint, is_required } = req.body as {
      signal_id?: string;
      stage_hint?: string;
      is_required?: boolean;
    };
    if (!signal_id) return res.status(400).json({ error: 'signal_id is required' });

    const pack = await getSignalPack(req.params['packId']);
    if (!pack) return res.status(404).json({ error: 'Signal pack not found' });
    if (pack.organisation_id && !(await assertOrgMember(pack.organisation_id, req.user!.id, res))) return;

    const entry = await addSignalToPack(req.params['packId'], signal_id, stage_hint, is_required ?? true);
    await incrementPackVersion(req.params['packId']);
    res.status(201).json(entry);
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── DELETE /api/signal-packs/:packId/signals/:signalId ────────────────────────

router.delete('/packs/:packId/signals/:signalId', async (req: Request, res: Response) => {
  try {
    const pack = await getSignalPack(req.params['packId']);
    if (!pack) return res.status(404).json({ error: 'Signal pack not found' });
    if (pack.organisation_id && !(await assertOrgMember(pack.organisation_id, req.user!.id, res))) return;

    await removeSignalFromPack(req.params['packId'], req.params['signalId']);
    await incrementPackVersion(req.params['packId']);
    res.json({ deleted: true });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── POST /api/signals/packs/:packId/regenerate-all ────────────────────────────
// Regenerates outputs for every client that has this pack deployed.

router.post('/packs/:packId/regenerate-all', async (req: Request, res: Response) => {
  try {
    const pack = await getSignalPack(req.params['packId']);
    if (!pack) return res.status(404).json({ error: 'Signal pack not found' });

    const orgId = req.query['org_id'] as string | undefined;
    if (!orgId) return res.status(400).json({ error: 'org_id query param is required' });
    if (!(await assertOrgMember(orgId, req.user!.id, res))) return;

    const clients = await getClientsByPack(req.params['packId'], orgId);
    const total = clients.length;
    let regenerated = 0;
    let failed = 0;

    await Promise.allSettled(
      clients.map(async (client) => {
        try {
          const full = await getClient(client.id, orgId);
          if (!full) throw new Error('Client not found');
          await generateComposableOutputs(full, client.id);
          regenerated++;
        } catch {
          failed++;
        }
      })
    );

    res.json({ regenerated, failed, total });
  } catch (err) {
    sendInternalError(res, err);
  }
});

export { router as signalsRouter };
