/**
 * Functional tests — planGuard middleware
 *
 * planGuard is a pure factory function that returns an Express middleware.
 * We mock the Express req/res/next objects — no actual HTTP server needed.
 */

import { describe, it, expect, vi } from 'vitest';
import { planGuard } from '../../../backend/src/api/middleware/planGuard';
import type { Request, Response, NextFunction } from 'express';

// ── Helpers ────────────────────────────────────────────────────────────────────

type Plan = 'free' | 'pro' | 'agency';

interface MockUser {
  id: string;
  email: string;
  plan: Plan;
  isSuperAdmin: boolean;
}

function makeReq(user: MockUser): Request {
  return { user } as unknown as Request;
}

function makeRes() {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  return { status, json, _json: json } as unknown as Response & { status: ReturnType<typeof vi.fn>; _json: ReturnType<typeof vi.fn> };
}

function makeNext(): NextFunction {
  return vi.fn() as unknown as NextFunction;
}

// ── Scenarios ─────────────────────────────────────────────────────────────────

describe('planGuard("agency")', () => {
  const guard = planGuard('agency');

  it('rejects a user with plan="pro" with HTTP 403', () => {
    const req = makeReq({ id: 'u1', email: 'pro@example.com', plan: 'pro', isSuperAdmin: false });
    const res = makeRes();
    const next = makeNext();

    guard(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a user with plan="free" with HTTP 403', () => {
    const req = makeReq({ id: 'u2', email: 'free@example.com', plan: 'free', isSuperAdmin: false });
    const res = makeRes();
    const next = makeNext();

    guard(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts a user with plan="agency" — calls next()', () => {
    const req = makeReq({ id: 'u3', email: 'agency@example.com', plan: 'agency', isSuperAdmin: false });
    const res = makeRes();
    const next = makeNext();

    guard(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('accepts a super admin regardless of plan (plan="free")', () => {
    const req = makeReq({ id: 'u4', email: 'admin@example.com', plan: 'free', isSuperAdmin: true });
    const res = makeRes();
    const next = makeNext();

    guard(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('accepts a super admin with plan="pro" (non-agency plan)', () => {
    const req = makeReq({ id: 'u5', email: 'admin2@example.com', plan: 'pro', isSuperAdmin: true });
    const res = makeRes();
    const next = makeNext();

    guard(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('403 response body contains requiredPlan and currentPlan', () => {
    const req = makeReq({ id: 'u6', email: 'pro@test.com', plan: 'pro', isSuperAdmin: false });
    const jsonFn = vi.fn();
    const res = {
      status: vi.fn().mockReturnValue({ json: jsonFn }),
    } as unknown as Response;
    const next = makeNext();

    guard(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    const body = jsonFn.mock.calls[0][0];
    expect(body).toMatchObject({
      requiredPlan: 'agency',
      currentPlan: 'pro',
    });
    expect(body.error).toContain('agency');
  });
});

describe('planGuard("pro")', () => {
  const guard = planGuard('pro');

  it('accepts a user with plan="pro"', () => {
    const req = makeReq({ id: 'u7', email: 'pro@example.com', plan: 'pro', isSuperAdmin: false });
    const res = makeRes();
    const next = makeNext();

    guard(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('accepts a user with plan="agency" (agency >= pro)', () => {
    const req = makeReq({ id: 'u8', email: 'agency@example.com', plan: 'agency', isSuperAdmin: false });
    const res = makeRes();
    const next = makeNext();

    guard(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('rejects a user with plan="free"', () => {
    const req = makeReq({ id: 'u9', email: 'free@example.com', plan: 'free', isSuperAdmin: false });
    const res = makeRes();
    const next = makeNext();

    guard(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
