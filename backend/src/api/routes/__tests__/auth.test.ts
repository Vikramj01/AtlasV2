/**
 * Auth routes integration tests — /api/auth
 *
 * Covers: POST /signup, POST /forgot-password
 * All Supabase admin calls and email service are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/services/database/supabase', () => ({
  supabaseAdmin: {
    auth: {
      admin: {
        generateLink: vi.fn(),
      },
    },
  },
}));

vi.mock('@/services/email/emailService', () => ({
  sendSignupConfirmationEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendPasswordResetEmail: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('@/api/middleware/authMiddleware', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    next();
  },
}));

vi.mock('@/config/env', () => ({
  env: {
    FRONTEND_URL: 'https://app.example.com',
    SUPER_ADMIN_EMAILS: ['admin@example.com'],
    ADMIN_EMAILS: ['admin@example.com'],
  },
}));

vi.mock('@/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import * as supabaseModule from '@/services/database/supabase';
import * as emailService from '@/services/email/emailService';
import { authRouter } from '../auth';

// ── Test app ──────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  return request(app);
}

// ── POST /api/auth/signup ─────────────────────────────────────────────────────

describe('POST /api/auth/signup', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 201 and sends confirmation email on valid credentials', async () => {
    vi.mocked(supabaseModule.supabaseAdmin.auth.admin.generateLink).mockResolvedValue({
      data: { properties: { action_link: 'https://supabase.co/confirm?token=abc' }, user: null as any, hashed_token: '' },
      error: null,
    } as any);

    const res = await buildApp()
      .post('/api/auth/signup')
      .send({ email: 'newuser@example.com', password: 'securePass1' });

    expect(res.status).toBe(201);
    expect(res.body.message).toContain('email');
    expect(emailService.sendSignupConfirmationEmail).toHaveBeenCalledOnce();
  });

  it('returns 400 for invalid email format', async () => {
    const res = await buildApp()
      .post('/api/auth/signup')
      .send({ email: 'not-an-email', password: 'securePass1' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });

  it('returns 400 for password shorter than 8 characters', async () => {
    const res = await buildApp()
      .post('/api/auth/signup')
      .send({ email: 'user@example.com', password: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/password/i);
  });

  it('returns 409 when email is already registered', async () => {
    vi.mocked(supabaseModule.supabaseAdmin.auth.admin.generateLink).mockResolvedValue({
      data: null as any,
      error: { message: 'User already registered' } as any,
    });

    const res = await buildApp()
      .post('/api/auth/signup')
      .send({ email: 'existing@example.com', password: 'securePass1' });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('already exists');
  });

  it('returns 400 when missing email', async () => {
    const res = await buildApp()
      .post('/api/auth/signup')
      .send({ password: 'securePass1' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when missing password', async () => {
    const res = await buildApp()
      .post('/api/auth/signup')
      .send({ email: 'user@example.com' });

    expect(res.status).toBe(400);
  });
});

// ── POST /api/auth/forgot-password ────────────────────────────────────────────

describe('POST /api/auth/forgot-password', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 200 with same message regardless of whether account exists', async () => {
    vi.mocked(supabaseModule.supabaseAdmin.auth.admin.generateLink).mockResolvedValue({
      data: { properties: { action_link: 'https://supabase.co/reset?token=xyz' }, user: null as any, hashed_token: '' },
      error: null,
    } as any);

    const res = await buildApp()
      .post('/api/auth/forgot-password')
      .send({ email: 'user@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('reset link');
  });

  it('returns same 200 message when account does not exist (prevents enumeration)', async () => {
    vi.mocked(supabaseModule.supabaseAdmin.auth.admin.generateLink).mockResolvedValue({
      data: null as any,
      error: { message: 'User not found' } as any,
    });

    const res = await buildApp()
      .post('/api/auth/forgot-password')
      .send({ email: 'ghost@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('reset link');
  });

  it('returns 400 for invalid email', async () => {
    const res = await buildApp()
      .post('/api/auth/forgot-password')
      .send({ email: 'invalid' });

    expect(res.status).toBe(400);
  });

  it('sends password reset email when account exists', async () => {
    vi.mocked(supabaseModule.supabaseAdmin.auth.admin.generateLink).mockResolvedValue({
      data: { properties: { action_link: 'https://supabase.co/reset?token=xyz' }, user: null as any, hashed_token: '' },
      error: null,
    } as any);

    await buildApp()
      .post('/api/auth/forgot-password')
      .send({ email: 'user@example.com' });

    expect(emailService.sendPasswordResetEmail).toHaveBeenCalledOnce();
    const call = vi.mocked(emailService.sendPasswordResetEmail).mock.calls[0][0];
    expect(call.resetUrl).toContain('reset?token=xyz');
  });
});
