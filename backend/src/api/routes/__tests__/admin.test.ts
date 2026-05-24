/**
 * Admin routes integration tests — /api/admin
 *
 * Covers: admin-only access guard, stats, user plan patch,
 *         user deletion, non-admin rejection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/services/database/adminQueries', () => ({
  getAdminStats: vi.fn(),
  listAdminUsers: vi.fn(),
  setUserPlan: vi.fn(),
  getActivityFeed: vi.fn(),
  getAdminAlerts: vi.fn(),
  dismissAdminAlert: vi.fn(),
  deleteUser: vi.fn(),
}));

vi.mock('@/services/database/usageQueries', () => ({
  getUsagePortfolio: vi.fn(),
  getOrgDailyBreakdown: vi.fn(),
  getOrgDomainBreakdown: vi.fn(),
  getOrgAIBreakdown: vi.fn(),
  getOrgRawEvents: vi.fn(),
  getReconciliationSnapshots: vi.fn(),
}));

vi.mock('@/api/middleware/authMiddleware', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    next();
  },
}));

vi.mock('@/config/env', () => ({
  env: {
    ADMIN_EMAILS: ['admin@example.com'],
    SUPER_ADMIN_EMAILS: ['admin@example.com'],
  },
}));

vi.mock('@/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import * as adminQueries from '@/services/database/adminQueries';
import { adminRouter } from '../admin';

// ── Test apps ─────────────────────────────────────────────────────────────────

function buildApp(isAdmin: boolean = true) {
  const app = express();
  app.use((req: any, _res: any, next: any) => {
    req.user = {
      id: 'u1',
      email: isAdmin ? 'admin@example.com' : 'regular@example.com',
      plan: isAdmin ? 'agency' : 'pro',
      isSuperAdmin: isAdmin,
    };
    next();
  });
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  return request(app);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/admin/me', () => {
  it('returns isAdmin: true for admin users', async () => {
    const res = await buildApp(true).get('/api/admin/me');

    expect(res.status).toBe(200);
    expect(res.body.isAdmin).toBe(true);
  });

  it('returns 403 for non-admin users', async () => {
    const res = await buildApp(false).get('/api/admin/me');

    expect(res.status).toBe(403);
  });
});

describe('GET /api/admin/stats', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns platform statistics for admin', async () => {
    vi.mocked(adminQueries.getAdminStats).mockResolvedValue({
      user_count: 150,
      session_count: 450,
      audit_count: 890,
    } as any);

    const res = await buildApp(true).get('/api/admin/stats');

    expect(res.status).toBe(200);
    expect(res.body.user_count).toBe(150);
  });

  it('blocks non-admin users', async () => {
    const res = await buildApp(false).get('/api/admin/stats');

    expect(res.status).toBe(403);
    expect(adminQueries.getAdminStats).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/users', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns all users for admin', async () => {
    vi.mocked(adminQueries.listAdminUsers).mockResolvedValue([
      { id: 'u1', email: 'user1@example.com', plan: 'pro' },
      { id: 'u2', email: 'user2@example.com', plan: 'free' },
    ] as any);

    const res = await buildApp(true).get('/api/admin/users');

    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(2);
  });
});

describe('PATCH /api/admin/users/:id/plan', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('updates user plan to valid value', async () => {
    vi.mocked(adminQueries.setUserPlan).mockResolvedValue(undefined);

    const res = await buildApp(true)
      .patch('/api/admin/users/user-123/plan')
      .send({ plan: 'agency' });

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(true);
    expect(adminQueries.setUserPlan).toHaveBeenCalledWith('user-123', 'agency');
  });

  it('returns 400 for invalid plan value', async () => {
    const res = await buildApp(true)
      .patch('/api/admin/users/user-123/plan')
      .send({ plan: 'enterprise' });

    expect(res.status).toBe(400);
    expect(adminQueries.setUserPlan).not.toHaveBeenCalled();
  });

  it('returns 400 when plan is missing', async () => {
    const res = await buildApp(true)
      .patch('/api/admin/users/user-123/plan')
      .send({});

    expect(res.status).toBe(400);
  });

  it('blocks non-admin users', async () => {
    const res = await buildApp(false)
      .patch('/api/admin/users/user-123/plan')
      .send({ plan: 'agency' });

    expect(res.status).toBe(403);
    expect(adminQueries.setUserPlan).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/admin/users/:id', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('deletes user successfully', async () => {
    vi.mocked(adminQueries.deleteUser).mockResolvedValue(undefined);

    const res = await buildApp(true).delete('/api/admin/users/user-123');

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
    expect(adminQueries.deleteUser).toHaveBeenCalledWith('user-123');
  });

  it('blocks non-admin users', async () => {
    const res = await buildApp(false).delete('/api/admin/users/user-123');

    expect(res.status).toBe(403);
    expect(adminQueries.deleteUser).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/alerts', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns admin alerts', async () => {
    vi.mocked(adminQueries.getAdminAlerts).mockResolvedValue([
      { id: 'alert-1', type: 'quota_exceeded', message: 'Browserbase quota near limit' },
    ] as any);

    const res = await buildApp(true).get('/api/admin/alerts');

    expect(res.status).toBe(200);
    expect(res.body.alerts).toHaveLength(1);
  });
});
