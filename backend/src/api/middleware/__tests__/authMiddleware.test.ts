/**
 * authMiddleware unit tests
 *
 * Verifies: Bearer token required, invalid token rejected, valid token
 * populates req.user correctly (plan from profile, isSuperAdmin from env).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockGetUser, mockFrom } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock('@/services/database/supabase', () => ({
  supabaseAdmin: {
    auth: { getUser: mockGetUser },
    from: mockFrom,
  },
}));

vi.mock('@/config/env', () => ({
  env: {
    SUPER_ADMIN_EMAILS: ['superadmin@example.com'],
    ADMIN_EMAILS: ['admin@example.com'],
  },
}));

vi.mock('@/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { authMiddleware } from '../authMiddleware';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRes() {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  return { status, json } as unknown as Response;
}

function makeNext(): NextFunction {
  return vi.fn() as unknown as NextFunction;
}

function makeReq(token?: string): Request {
  return {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    user: undefined,
  } as unknown as Request;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('authMiddleware', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 401 when Authorization header is missing', async () => {
    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when Authorization header is not Bearer scheme', async () => {
    const req = { headers: { authorization: 'Basic dXNlcjpwYXNz' }, user: undefined } as unknown as Request;
    const res = makeRes();
    const next = makeNext();

    await authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when Supabase rejects the token', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'Invalid JWT' } });

    const req = makeReq('bad-token');
    const res = makeRes();
    const next = makeNext();

    await authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('populates req.user and calls next() on valid token', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-123', email: 'user@example.com' } },
      error: null,
    });
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { plan: 'pro' }, error: null }),
    });

    const req = makeReq('valid-jwt');
    const res = makeRes();
    const next = makeNext();

    await authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toMatchObject({
      id: 'user-123',
      email: 'user@example.com',
      plan: 'pro',
      isSuperAdmin: false,
    });
  });

  it('sets isSuperAdmin=true when email is in SUPER_ADMIN_EMAILS', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'sa-001', email: 'superadmin@example.com' } },
      error: null,
    });
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { plan: 'free' }, error: null }),
    });

    const req = makeReq('sa-token');
    const res = makeRes();
    const next = makeNext();

    await authMiddleware(req, res, next);

    expect(req.user.isSuperAdmin).toBe(true);
    expect(next).toHaveBeenCalled();
  });

  it('defaults plan to "free" when profile has no plan', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-456', email: 'noprofile@example.com' } },
      error: null,
    });
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Row not found' } }),
    });

    const req = makeReq('valid-jwt-2');
    const res = makeRes();
    const next = makeNext();

    await authMiddleware(req, res, next);

    expect(req.user.plan).toBe('free');
    expect(next).toHaveBeenCalled();
  });
});
