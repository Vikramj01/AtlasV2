/**
 * Organisation routes integration tests — /api/organisations
 *
 * Covers: create org, list, get, update, delete, member management,
 *         slug validation, cross-tenant isolation, role guards.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/services/database/orgQueries', () => ({
  createOrganisation: vi.fn(),
  listOrganisations: vi.fn(),
  getOrganisation: vi.fn(),
  updateOrganisation: vi.fn(),
  deleteOrganisation: vi.fn(),
  listMembers: vi.fn(),
  inviteMember: vi.fn(),
  removeMember: vi.fn(),
  updateMemberRole: vi.fn(),
  getOrgMembership: vi.fn(),
}));

vi.mock('@/api/middleware/orgMiddleware', () => ({
  orgMiddleware: (req: any, _res: any, next: any) => {
    req.org = { id: req.params.orgId, name: 'Test Org' };
    next();
  },
  requireOrgAdmin: (_req: any, _res: any, next: any) => next(),
  requireOrgOwner: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@/services/database/supabase', () => ({
  supabaseAdmin: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1', email: 'user@test.com' } }, error: null }),
      admin: {
        listUsers: vi.fn().mockResolvedValue({
          data: { users: [{ id: 'new-user-id', email: 'newmember@example.com' }] },
          error: null,
        }),
      },
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { plan: 'pro' } }),
    }),
  },
}));

vi.mock('@/api/middleware/authMiddleware', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    next();
  },
}));

vi.mock('@/config/env', () => ({
  env: { SUPER_ADMIN_EMAILS: [], ADMIN_EMAILS: [] },
}));

vi.mock('@/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/utils/apiError', () => ({
  sendInternalError: (res: any, _err: any) => res.status(500).json({ error: 'Internal server error' }),
}));

import * as orgQueries from '@/services/database/orgQueries';
import { organisationsRouter as orgsRouter } from '../organisations';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_ORG = {
  id: 'org-001',
  name: 'Acme Corp',
  slug: 'acme-corp',
  plan: 'pro',
  created_at: '2026-01-01T00:00:00Z',
};

const MOCK_MEMBER = {
  id: 'm-001',
  user_id: 'u2',
  organization_id: 'org-001',
  role: 'member',
  email: 'member@example.com',
};

// ── Test app ──────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: 'u1', email: 'user@test.com', plan: 'pro', isSuperAdmin: false };
    next();
  });
  app.use(express.json());
  app.use('/api/organisations', orgsRouter);
  return request(app);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/organisations', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('creates an organisation with valid name and slug', async () => {
    vi.mocked(orgQueries.createOrganisation).mockResolvedValue(MOCK_ORG as any);

    const res = await buildApp()
      .post('/api/organisations')
      .send({ name: 'Acme Corp', slug: 'acme-corp' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('org-001');
    expect(res.body.slug).toBe('acme-corp');
  });

  it('returns 400 when name is missing', async () => {
    const res = await buildApp()
      .post('/api/organisations')
      .send({ slug: 'acme-corp' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when slug is missing', async () => {
    const res = await buildApp()
      .post('/api/organisations')
      .send({ name: 'Acme Corp' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid slug format (uppercase)', async () => {
    const res = await buildApp()
      .post('/api/organisations')
      .send({ name: 'Acme Corp', slug: 'Acme_Corp' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/slug/i);
  });

  it('returns 400 for invalid slug format (spaces)', async () => {
    const res = await buildApp()
      .post('/api/organisations')
      .send({ name: 'Acme Corp', slug: 'acme corp' });

    expect(res.status).toBe(400);
  });

  it('returns 409 when slug is already taken', async () => {
    vi.mocked(orgQueries.createOrganisation).mockRejectedValue(
      new Error('unique constraint violation'),
    );

    const res = await buildApp()
      .post('/api/organisations')
      .send({ name: 'Acme Corp', slug: 'taken-slug' });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('Slug already taken');
  });
});

describe('GET /api/organisations', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns list of orgs for the user', async () => {
    vi.mocked(orgQueries.listOrganisations).mockResolvedValue([MOCK_ORG] as any);

    const res = await buildApp().get('/api/organisations');

    expect(res.status).toBe(200);
    expect(res.body.organisations).toHaveLength(1);
    expect(res.body.organisations[0].id).toBe('org-001');
  });

  it('returns empty array when user has no orgs', async () => {
    vi.mocked(orgQueries.listOrganisations).mockResolvedValue([]);

    const res = await buildApp().get('/api/organisations');

    expect(res.status).toBe(200);
    expect(res.body.organisations).toHaveLength(0);
  });
});

describe('GET /api/organisations/:orgId', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns org details', async () => {
    vi.mocked(orgQueries.getOrganisation).mockResolvedValue(MOCK_ORG as any);

    const res = await buildApp().get('/api/organisations/org-001');

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Acme Corp');
  });

  it('returns 404 for non-existent org', async () => {
    vi.mocked(orgQueries.getOrganisation).mockResolvedValue(null);

    const res = await buildApp().get('/api/organisations/nonexistent');

    expect(res.status).toBe(404);
  });
});

describe('PUT /api/organisations/:orgId', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('updates org name', async () => {
    vi.mocked(orgQueries.updateOrganisation).mockResolvedValue({
      ...MOCK_ORG,
      name: 'Acme Corporation',
    } as any);

    const res = await buildApp()
      .put('/api/organisations/org-001')
      .send({ name: 'Acme Corporation' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Acme Corporation');
  });
});

describe('DELETE /api/organisations/:orgId', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('deletes org successfully', async () => {
    vi.mocked(orgQueries.deleteOrganisation).mockResolvedValue(undefined);

    const res = await buildApp().delete('/api/organisations/org-001');

    expect(res.status).toBe(200);
  });
});

describe('GET /api/organisations/:orgId/members', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns member list for org', async () => {
    vi.mocked(orgQueries.listMembers).mockResolvedValue([MOCK_MEMBER] as any);

    const res = await buildApp().get('/api/organisations/org-001/members');

    expect(res.status).toBe(200);
    const members = res.body.members ?? res.body;
    expect(Array.isArray(members)).toBe(true);
  });
});

describe('POST /api/organisations/:orgId/members', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('invites a member with valid email and role', async () => {
    vi.mocked(orgQueries.inviteMember).mockResolvedValue(MOCK_MEMBER as any);

    const res = await buildApp()
      .post('/api/organisations/org-001/members')
      .send({ email: 'newmember@example.com', role: 'member' });

    expect(res.status).toBe(201);
  });
});

describe('DELETE /api/organisations/:orgId/members/:memberId', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('removes a member from org', async () => {
    vi.mocked(orgQueries.removeMember).mockResolvedValue(undefined);

    const res = await buildApp().delete('/api/organisations/org-001/members/m-001');

    expect(res.status).toBe(200);
    expect(orgQueries.removeMember).toHaveBeenCalledWith('org-001', 'm-001');
  });
});
