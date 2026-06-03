/**
 * Organisation routes — /api/organisations
 *
 * All routes require auth. Org-scoped routes additionally require
 * orgMiddleware (validates membership and attaches req.org).
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { authMiddleware } from '@/api/middleware/authMiddleware';
import { orgMiddleware, requireOrgAdmin, requireOrgOwner } from '@/api/middleware/orgMiddleware';
import { sendInternalError } from '@/utils/apiError';
import {
  createOrganisation,
  listOrganisations,
  getOrganisation,
  updateOrganisation,
  deleteOrganisation,
  listMembers,
  inviteMember,
  removeMember,
  updateMemberRole,
} from '@/services/database/orgQueries';
import { supabaseAdmin } from '@/services/database/supabase';
import logger from '@/utils/logger';
import type { MemberRole } from '@/types/organisation';

const router = Router();
router.use(authMiddleware);

// ── POST /api/organisations ────────────────────────────────────────────────────

router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, slug, org_type, website_url } = req.body as {
      name?: string; slug?: string; org_type?: string; website_url?: string;
    };
    if (!name || !slug) {
      return res.status(400).json({ error: 'name and slug are required' });
    }
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return res.status(400).json({ error: 'slug must be lowercase alphanumeric with hyphens only' });
    }
    if (org_type && org_type !== 'agency' && org_type !== 'brand') {
      return res.status(400).json({ error: 'org_type must be agency or brand' });
    }
    const org = await createOrganisation(req.user!.id, {
      name,
      slug,
      org_type: org_type as 'agency' | 'brand' | undefined,
      website_url,
    });
    res.status(201).json(org);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('unique')) return res.status(409).json({ error: 'Slug already taken' });
    sendInternalError(res, err);
  }
});

// ── GET /api/organisations/me/primary-client ──────────────────────────────────
// Returns the primary client for the calling user's brand org, or null.
// Must be registered before /:orgId to avoid routing collision.

router.get('/me/primary-client', async (req: Request, res: Response) => {
  const userId = req.user!.id;
  try {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('organisation_id')
      .eq('id', userId)
      .single();

    if (!profile) {
      return res.status(404).json({ data: null, error: 'Profile not found', message: null });
    }

    const orgId = (profile as { organisation_id: string | null }).organisation_id;
    if (!orgId) return res.json({ data: null, error: null, message: null });

    const { data: org } = await supabaseAdmin
      .from('organisations')
      .select('primary_client_id')
      .eq('id', orgId)
      .single();

    const primaryClientId = org ? (org as { primary_client_id: string | null }).primary_client_id : null;
    if (!primaryClientId) return res.json({ data: null, error: null, message: null });

    const { data: client } = await supabaseAdmin
      .from('clients')
      .select('*')
      .eq('id', primaryClientId)
      .single();

    res.json({ data: client ?? null, error: null, message: null });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── GET /api/organisations ─────────────────────────────────────────────────────

router.get('/', async (req: Request, res: Response) => {
  try {
    const orgs = await listOrganisations(req.user!.id);
    res.json({ organisations: orgs });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── GET /api/organisations/:orgId ─────────────────────────────────────────────

router.get('/:orgId', orgMiddleware, async (req: Request, res: Response) => {
  try {
    const org = await getOrganisation(req.params['orgId']);
    if (!org) return res.status(404).json({ error: 'Organisation not found' });
    res.json(org);
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── PUT /api/organisations/:orgId ─────────────────────────────────────────────

router.put('/:orgId', orgMiddleware, requireOrgAdmin, async (req: Request, res: Response) => {
  try {
    const { name } = req.body as { name?: string };
    const org = await updateOrganisation(req.params['orgId'], { name });
    res.json(org);
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── DELETE /api/organisations/:orgId ──────────────────────────────────────────

router.delete('/:orgId', orgMiddleware, requireOrgOwner, async (req: Request, res: Response) => {
  try {
    await deleteOrganisation(req.params['orgId']);
    res.json({ deleted: true });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── GET /api/organisations/:orgId/members ─────────────────────────────────────

router.get('/:orgId/members', orgMiddleware, async (req: Request, res: Response) => {
  try {
    const members = await listMembers(req.params['orgId']);
    res.json({ members });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── POST /api/organisations/:orgId/members ────────────────────────────────────
// Invite by email — looks up user_id from auth.users

router.post('/:orgId/members', orgMiddleware, requireOrgAdmin, async (req: Request, res: Response) => {
  try {
    const { email, role = 'member' } = req.body as { email?: string; role?: string };
    if (!email) return res.status(400).json({ error: 'email is required' });

    const validRoles: MemberRole[] = ['admin', 'member'];
    if (!validRoles.includes(role as MemberRole)) {
      return res.status(400).json({ error: 'role must be admin or member' });
    }

    // Enforce per-plan member seat limits
    const plan = req.user!.plan;
    if (!req.user!.isSuperAdmin) {
      const existingMembers = await listMembers(req.params['orgId']);
      const nonOwnerCount = existingMembers.filter((m) => m.role !== 'owner').length;

      if (plan === 'free' || plan === 'pro') {
        return res.status(403).json({
          error: 'Your plan only supports a single user. Upgrade to Agency to add team members.',
        });
      }

      // Agency: owner + up to 5 additional members (admin or member roles)
      if (plan === 'agency' && nonOwnerCount >= 5) {
        return res.status(403).json({
          error: 'You have reached the 5 team member limit on the Agency plan. Contact support at support@atlas.vimi.digital to add more seats.',
        });
      }
    }

    // Look up user by email via admin API
    const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers();
    if (error) return sendInternalError(res, error);
    const user = users.find((u) => u.email === email);
    if (!user) {
      return res.status(404).json({ error: 'No Atlas account found with that email address' });
    }

    const member = await inviteMember(req.params['orgId'], user.id, role as MemberRole);
    logger.info({ orgId: req.params['orgId'] }, 'Member invited');
    res.status(201).json(member);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('unique')) return res.status(409).json({ error: 'User is already a member' });
    sendInternalError(res, err);
  }
});

// ── PATCH /api/organisations/:orgId/members/:memberId ─────────────────────────

router.patch('/:orgId/members/:memberId', orgMiddleware, requireOrgAdmin, async (req: Request, res: Response) => {
  try {
    const { role } = req.body as { role?: string };
    if (!role) return res.status(400).json({ error: 'role is required' });

    const validRoles: MemberRole[] = ['admin', 'member'];
    if (!validRoles.includes(role as MemberRole)) {
      return res.status(400).json({ error: 'role must be admin or member' });
    }

    const member = await updateMemberRole(req.params['orgId'], req.params['memberId'], role as MemberRole);
    res.json(member);
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── DELETE /api/organisations/:orgId/members/:memberId ────────────────────────

router.delete('/:orgId/members/:memberId', orgMiddleware, requireOrgAdmin, async (req: Request, res: Response) => {
  try {
    await removeMember(req.params['orgId'], req.params['memberId']);
    res.json({ deleted: true });
  } catch (err) {
    sendInternalError(res, err);
  }
});

export { router as organisationsRouter };
