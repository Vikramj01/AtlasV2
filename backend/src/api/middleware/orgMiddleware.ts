/**
 * orgMiddleware — validates that the authenticated user is a member of the
 * organisation specified in `req.params.orgId`, and attaches `req.org` with
 * the membership details.
 *
 * Usage: apply after `authMiddleware` on any route that needs org-scoping.
 *
 * Example:
 *   router.use('/:orgId', authMiddleware, orgMiddleware, ...);
 */

import type { Request, Response, NextFunction } from 'express';
import { getOrgMembership, getOrganisation } from '@/services/database/orgQueries';
import type { Organisation, OrganisationMember } from '@/types/organisation';

declare global {
  // Augment Express Request so TypeScript knows about req.org
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      org?: Organisation;
      orgMembership?: OrganisationMember;
    }
  }
}

export async function orgMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const orgId = req.params['orgId'];
  if (!orgId) {
    res.status(400).json({ error: 'orgId is required' });
    return;
  }

  if (!req.user?.id) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const membership = await getOrgMembership(orgId, req.user.id);
  if (!membership) {
    res.status(403).json({ error: 'You are not a member of this organisation' });
    return;
  }

  const org = await getOrganisation(orgId);
  if (!org) {
    res.status(404).json({ error: 'Organisation not found' });
    return;
  }

  req.org = org;
  req.orgMembership = membership;
  next();
}

/** Require the requesting user to be an admin or owner of the org. */
export function requireOrgAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.orgMembership) {
    res.status(403).json({ error: 'Not an org member' });
    return;
  }
  if (!['owner', 'admin'].includes(req.orgMembership.role)) {
    res.status(403).json({ error: 'Organisation admin or owner required' });
    return;
  }
  next();
}

/** Require the requesting user to be the owner of the org. */
export function requireOrgOwner(req: Request, res: Response, next: NextFunction): void {
  if (!req.orgMembership || req.orgMembership.role !== 'owner') {
    res.status(403).json({ error: 'Organisation owner required' });
    return;
  }
  next();
}
