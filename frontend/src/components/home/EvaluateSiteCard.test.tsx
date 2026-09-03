/**
 * EvaluateSiteCard — render smoke test.
 *
 * Verifies the rebuilt Scan Inputs form (site type, declared platforms,
 * primary channel, traffic regions) renders and gates submission correctly,
 * and that switching to "Advanced" renders RunAuditForm's expanded Scan
 * Inputs sections without crashing.
 *
 * Uses plain DOM assertions rather than @testing-library/jest-dom matchers —
 * this repo's npm workspaces hoist jest-dom to the root node_modules, which
 * resolves a different `vitest` module instance than the one this workspace's
 * local vitest binary actually runs tests under, so expect.extend() never
 * reaches the expect() this file's tests call. Plain assertions sidestep it.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// useAudit -> auditApi -> lib/supabase reads VITE_SUPABASE_URL/ANON_KEY at
// import time and throws if unset — irrelevant to this render smoke test,
// which never actually submits, so stub the client rather than requiring
// real env vars.
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
}));

import { EvaluateSiteCard } from './EvaluateSiteCard';

function renderCard() {
  return render(
    <MemoryRouter>
      <EvaluateSiteCard />
    </MemoryRouter>,
  );
}

describe('EvaluateSiteCard', () => {
  it('renders the core Scan Inputs fields', () => {
    renderCard();
    expect(screen.getByLabelText('Website URL')).toBeTruthy();
    expect(screen.getByText('Site type')).toBeTruthy();
    expect(screen.getByText('Ad platforms you buy')).toBeTruthy();
    expect(screen.getByText('Traffic regions')).toBeTruthy();
    // All 7 declared-platform chips present
    for (const label of ['Google Ads', 'Meta', 'TikTok', 'LinkedIn', 'Microsoft', 'Reddit', 'Pinterest']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
  });

  it('disables Evaluate until URL, a declared platform, and a region are set', () => {
    renderCard();
    const submit = screen.getByRole('button', { name: 'Evaluate' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Website URL'), { target: { value: 'https://example.com' } });
    expect(submit.disabled).toBe(true); // no platform declared yet

    fireEvent.click(screen.getByRole('button', { name: 'Google Ads' }));
    // US region is selected by default, url + platform now set — should be enabled
    expect(submit.disabled).toBe(false);
  });

  it('shows a primary channel selector only once a platform is declared', () => {
    renderCard();
    expect(screen.queryByText('Primary channel')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Meta' }));
    expect(screen.getByText('Primary channel')).toBeTruthy();
  });

  it('deselecting all platforms disables submit again', () => {
    renderCard();
    fireEvent.change(screen.getByLabelText('Website URL'), { target: { value: 'https://example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Google Ads' }));
    const submit = screen.getByRole('button', { name: 'Evaluate' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Google Ads' })); // toggle off
    expect(submit.disabled).toBe(true);
  });

  it("switching to Advanced renders RunAuditForm's expanded Scan Inputs sections", () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Advanced — map the full journey' }));

    expect(screen.getByText('1. Site type')).toBeTruthy();
    expect(screen.getByText('2. Ad platforms')).toBeTruthy();
    expect(screen.getByText('3. Regions')).toBeTruthy();
    expect(screen.getByText('4. Domains & journey URLs')).toBeTruthy();
    expect(screen.getByText('Secondary motion')).toBeTruthy();
    expect(screen.getByText(/Monthly spend band/)).toBeTruthy();
    expect(screen.getByText(/CMP in use/)).toBeTruthy();
    expect(screen.getByText(/Product \/ app domain/)).toBeTruthy();
  });
});
