/**
 * Billing routes integration tests — /api/billing
 *
 * Covers:
 *   POST /checkout  — creates Stripe Checkout Session
 *   POST /portal    — creates Billing Portal session
 *   GET  /status    — returns current plan
 *   POST /webhook   — Stripe signature verification + event handling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/services/stripe/subscriptionService', () => ({
  createCheckoutSession: vi.fn(),
  createPortalSession: vi.fn(),
  getBillingStatus: vi.fn(),
  syncSubscriptionToProfile: vi.fn(),
  markProfilePastDue: vi.fn(),
}));

vi.mock('@/services/stripe/client', () => ({
  getStripe: vi.fn().mockReturnValue({
    webhooks: {
      constructEvent: vi.fn(),
    },
    subscriptions: {
      retrieve: vi.fn(),
    },
  }),
}));

vi.mock('@/services/database/supabase', () => ({
  supabaseAdmin: {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1', email: 'user@test.com' } }, error: null }) },
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
  env: {
    FRONTEND_URL: 'https://app.example.com',
    STRIPE_WEBHOOK_SECRET: 'whsec_test',
    SUPER_ADMIN_EMAILS: [],
    ADMIN_EMAILS: [],
  },
}));

vi.mock('@/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import * as subscriptionService from '@/services/stripe/subscriptionService';
import { getStripe } from '@/services/stripe/client';
import { billingRouter } from '../billing';

// ── Test app ──────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use((req, _res, next) => {
    (req as any).user = { id: 'u1', email: 'user@test.com', plan: 'pro', isSuperAdmin: false };
    next();
  });
  app.use(express.json());
  app.use('/api/billing', billingRouter);
  return request(app);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/billing/checkout', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns checkout URL for valid plan', async () => {
    vi.mocked(subscriptionService.createCheckoutSession).mockResolvedValue('https://checkout.stripe.com/session123');

    const res = await buildApp()
      .post('/api/billing/checkout')
      .send({ plan: 'pro' });

    expect(res.status).toBe(200);
    expect(res.body.data.url).toBe('https://checkout.stripe.com/session123');
  });

  it('returns 400 for invalid plan name', async () => {
    const res = await buildApp()
      .post('/api/billing/checkout')
      .send({ plan: 'enterprise' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when plan is missing', async () => {
    const res = await buildApp()
      .post('/api/billing/checkout')
      .send({});

    expect(res.status).toBe(400);
  });

  it('passes correct user id and plan to createCheckoutSession', async () => {
    vi.mocked(subscriptionService.createCheckoutSession).mockResolvedValue('https://stripe.com/url');

    await buildApp()
      .post('/api/billing/checkout')
      .send({ plan: 'agency' });

    expect(subscriptionService.createCheckoutSession).toHaveBeenCalledWith(
      'u1',
      'user@test.com',
      'agency',
      expect.stringContaining('/success'),
      expect.stringContaining('/cancel'),
    );
  });
});

describe('POST /api/billing/portal', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns portal URL', async () => {
    vi.mocked(subscriptionService.createPortalSession).mockResolvedValue('https://billing.stripe.com/portal123');

    const res = await buildApp().post('/api/billing/portal');

    expect(res.status).toBe(200);
    expect(res.body.data.url).toContain('billing.stripe.com');
  });

  it('returns 400 when user has no Stripe customer', async () => {
    vi.mocked(subscriptionService.createPortalSession).mockRejectedValue(
      Object.assign(new Error('No Stripe customer found for user'), {}),
    );

    const res = await buildApp().post('/api/billing/portal');

    expect(res.status).toBe(400);
  });
});

describe('GET /api/billing/status', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns plan, status, and period end', async () => {
    vi.mocked(subscriptionService.getBillingStatus).mockResolvedValue({
      plan: 'pro',
      status: 'active',
      current_period_end: '2026-12-31T00:00:00Z',
    } as any);

    const res = await buildApp().get('/api/billing/status');

    expect(res.status).toBe(200);
    expect(res.body.data.plan).toBe('pro');
    expect(res.body.data.status).toBe('active');
    expect(res.body.data.current_period_end).toBeDefined();
  });
});

describe('POST /api/billing/webhook', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 400 when stripe-signature header is missing', async () => {
    const app = express();
    app.use('/api/billing', billingRouter);

    const res = await request(app)
      .post('/api/billing/webhook')
      .send(Buffer.from('{}'));

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('stripe-signature');
  });

  it('returns 400 when signature verification fails', async () => {
    vi.mocked(getStripe().webhooks.constructEvent).mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature for payload');
    });

    const app = express();
    app.use('/api/billing', billingRouter);

    const res = await request(app)
      .post('/api/billing/webhook')
      .set('stripe-signature', 't=123,v1=bad')
      .send(Buffer.from('{}'));

    expect(res.status).toBe(400);
    expect(subscriptionService.syncSubscriptionToProfile).not.toHaveBeenCalled();
  });

  it('handles checkout.session.completed and syncs subscription', async () => {
    const mockEvent = {
      type: 'checkout.session.completed',
      id: 'evt_001',
      data: {
        object: {
          mode: 'subscription',
          subscription: 'sub_001',
        },
      },
    };

    vi.mocked(getStripe().webhooks.constructEvent).mockReturnValue(mockEvent as any);
    vi.mocked(getStripe().subscriptions.retrieve).mockResolvedValue({ id: 'sub_001' } as any);
    vi.mocked(subscriptionService.syncSubscriptionToProfile).mockResolvedValue(undefined);

    const app = express();
    app.use('/api/billing', billingRouter);

    const res = await request(app)
      .post('/api/billing/webhook')
      .set('stripe-signature', 'valid-sig')
      .send(Buffer.from(JSON.stringify(mockEvent)));

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
    expect(subscriptionService.syncSubscriptionToProfile).toHaveBeenCalled();
  });

  it('handles customer.subscription.deleted and syncs subscription', async () => {
    const mockEvent = {
      type: 'customer.subscription.deleted',
      id: 'evt_002',
      data: { object: { id: 'sub_002', status: 'canceled' } },
    };

    vi.mocked(getStripe().webhooks.constructEvent).mockReturnValue(mockEvent as any);
    vi.mocked(subscriptionService.syncSubscriptionToProfile).mockResolvedValue(undefined);

    const app = express();
    app.use('/api/billing', billingRouter);

    const res = await request(app)
      .post('/api/billing/webhook')
      .set('stripe-signature', 'valid-sig')
      .send(Buffer.from(JSON.stringify(mockEvent)));

    expect(res.status).toBe(200);
    expect(subscriptionService.syncSubscriptionToProfile).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sub_002' }),
    );
  });

  it('handles invoice.payment_failed and marks profile past due', async () => {
    const mockEvent = {
      type: 'invoice.payment_failed',
      id: 'evt_003',
      data: { object: { subscription: 'sub_003' } },
    };

    vi.mocked(getStripe().webhooks.constructEvent).mockReturnValue(mockEvent as any);
    vi.mocked(subscriptionService.markProfilePastDue).mockResolvedValue(undefined);

    const app = express();
    app.use('/api/billing', billingRouter);

    const res = await request(app)
      .post('/api/billing/webhook')
      .set('stripe-signature', 'valid-sig')
      .send(Buffer.from(JSON.stringify(mockEvent)));

    expect(res.status).toBe(200);
    expect(subscriptionService.markProfilePastDue).toHaveBeenCalledWith('sub_003');
  });
});
