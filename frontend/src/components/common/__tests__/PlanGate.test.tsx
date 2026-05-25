/**
 * PlanGate component tests
 *
 * Covers: renders children when plan meets requirement,
 *         shows upgrade prompt for insufficient plan,
 *         super admin always sees children,
 *         optimistic render while status is loading.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/store/billingStore', () => ({
  useBillingStore: vi.fn(),
}));

import { PlanGate } from '../PlanGate';
import { useBillingStore } from '@/store/billingStore';

function mockBillingStore(overrides: Record<string, unknown> = {}) {
  vi.mocked(useBillingStore).mockReturnValue({
    status: null,
    loadState: 'loaded',
    fetchStatus: vi.fn(),
    startCheckout: vi.fn(),
    checkoutLoading: false,
    ...overrides,
  } as any);
}

describe('PlanGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Plan access granted ───────────────────────────────────────────────────────

  it('renders children when user has pro plan and minPlan is pro', () => {
    mockBillingStore({ status: { plan: 'pro', isSuperAdmin: false }, loadState: 'loaded' });
    render(
      <PlanGate minPlan="pro">
        <div>Protected content</div>
      </PlanGate>,
    );
    expect(screen.getByText('Protected content')).toBeInTheDocument();
  });

  it('renders children when user has agency plan and minPlan is pro', () => {
    mockBillingStore({ status: { plan: 'agency', isSuperAdmin: false }, loadState: 'loaded' });
    render(
      <PlanGate minPlan="pro">
        <div>Agency content</div>
      </PlanGate>,
    );
    expect(screen.getByText('Agency content')).toBeInTheDocument();
  });

  it('renders children when user has agency plan and minPlan is agency', () => {
    mockBillingStore({ status: { plan: 'agency', isSuperAdmin: false }, loadState: 'loaded' });
    render(
      <PlanGate minPlan="agency">
        <div>Agency only</div>
      </PlanGate>,
    );
    expect(screen.getByText('Agency only')).toBeInTheDocument();
  });

  // ── Plan access denied ────────────────────────────────────────────────────────

  it('shows upgrade prompt when user is on free plan and minPlan is pro', () => {
    mockBillingStore({ status: { plan: 'free', isSuperAdmin: false }, loadState: 'loaded' });
    render(
      <PlanGate minPlan="pro">
        <div>Pro feature</div>
      </PlanGate>,
    );
    expect(screen.queryByText('Pro feature')).not.toBeInTheDocument();
    expect(screen.getByText('Pro plan required')).toBeInTheDocument();
  });

  it('shows upgrade prompt when user is on pro plan and minPlan is agency', () => {
    mockBillingStore({ status: { plan: 'pro', isSuperAdmin: false }, loadState: 'loaded' });
    render(
      <PlanGate minPlan="agency">
        <div>Agency feature</div>
      </PlanGate>,
    );
    expect(screen.queryByText('Agency feature')).not.toBeInTheDocument();
    expect(screen.getByText('Agency plan required')).toBeInTheDocument();
  });

  it('shows featureName in the upgrade heading when provided', () => {
    mockBillingStore({ status: { plan: 'free', isSuperAdmin: false }, loadState: 'loaded' });
    render(
      <PlanGate minPlan="pro" featureName="AI Planning Mode">
        <div>Hidden</div>
      </PlanGate>,
    );
    expect(screen.getByText('AI Planning Mode is a Pro feature')).toBeInTheDocument();
  });

  it('shows generic upgrade heading when featureName is omitted', () => {
    mockBillingStore({ status: { plan: 'free', isSuperAdmin: false }, loadState: 'loaded' });
    render(
      <PlanGate minPlan="pro">
        <div>Hidden</div>
      </PlanGate>,
    );
    expect(screen.getByRole('heading', { name: 'Upgrade to Pro' })).toBeInTheDocument();
  });

  // ── Super admin ───────────────────────────────────────────────────────────────

  it('always renders children for super admin regardless of plan', () => {
    mockBillingStore({
      status: { plan: 'free', isSuperAdmin: true },
      loadState: 'loaded',
    });
    render(
      <PlanGate minPlan="agency">
        <div>Admin only content</div>
      </PlanGate>,
    );
    expect(screen.getByText('Admin only content')).toBeInTheDocument();
  });

  // ── Loading state ─────────────────────────────────────────────────────────────

  it('renders children optimistically while status is loading', () => {
    mockBillingStore({ status: null, loadState: 'loading' });
    render(
      <PlanGate minPlan="pro">
        <div>Loading content</div>
      </PlanGate>,
    );
    expect(screen.getByText('Loading content')).toBeInTheDocument();
  });

  it('renders children optimistically while loadState is idle', () => {
    mockBillingStore({ status: null, loadState: 'idle' });
    render(
      <PlanGate minPlan="pro">
        <div>Idle content</div>
      </PlanGate>,
    );
    expect(screen.getByText('Idle content')).toBeInTheDocument();
  });
});
