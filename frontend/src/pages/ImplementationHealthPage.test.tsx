/**
 * GTMContainersSection — GTM OAuth connect/discover/finalize flow.
 *
 * Uses plain DOM assertions rather than @testing-library/jest-dom matchers —
 * see EvaluateSiteCard.test.tsx's header comment for why.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ImplementationHealthPage.tsx transitively imports slackApi/billingStore ->
// @/lib/supabase, which reads VITE_SUPABASE_URL/ANON_KEY at import time and
// throws if unset — irrelevant to this test, which only renders
// GTMContainersSection. Same workaround as EvaluateSiteCard.test.tsx.
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
}));

vi.mock('@/lib/api/ihcApi', () => ({
  ihcApi: {
    getContainers: vi.fn().mockResolvedValue([]),
    connectGTM: vi.fn(),
    discoverGtmAccounts: vi.fn(),
    finalizeGtmConnection: vi.fn(),
    uploadContainerJSON: vi.fn(),
    disconnectContainer: vi.fn(),
  },
}));

import { ihcApi } from '@/lib/api/ihcApi';
import { GTMContainersSection } from './ImplementationHealthPage';

function renderSection(initialEntry = '/settings/implementation-health') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <GTMContainersSection />
    </MemoryRouter>,
  );
}

describe('GTMContainersSection', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders a Connect with Google button that starts the flow', async () => {
    vi.mocked(ihcApi.connectGTM).mockResolvedValue({ auth_url: 'https://accounts.google.com/auth', state: 's1' });
    renderSection();

    await waitFor(() => expect(screen.getByText('No GTM container connected yet.')).toBeTruthy());

    const button = screen.getByRole('button', { name: /Connect with Google/i });
    fireEvent.click(button);

    await waitFor(() => expect(ihcApi.connectGTM).toHaveBeenCalledOnce());
  });

  it('resolves ?code=&state= on mount into a container picker', async () => {
    vi.mocked(ihcApi.discoverGtmAccounts).mockResolvedValue({
      ref: 'ref-1',
      accounts: [
        {
          accountId: 'acct1',
          name: 'My Account',
          containers: [{ containerId: 'cont1', name: 'My Container', publicId: 'GTM-XXXXX' }],
        },
      ],
    });

    renderSection('/settings/implementation-health/gtm/callback?code=abc&state=xyz');

    await waitFor(() => expect(ihcApi.discoverGtmAccounts).toHaveBeenCalledWith('abc', 'xyz'));
    await waitFor(() => expect(screen.getByText('Choose a container to connect')).toBeTruthy());
    expect(screen.getByText('My Container (GTM-XXXXX)')).toBeTruthy();
  });

  it('finalizes the picked container and refreshes the container list', async () => {
    vi.mocked(ihcApi.discoverGtmAccounts).mockResolvedValue({
      ref: 'ref-1',
      accounts: [
        {
          accountId: 'acct1',
          name: 'My Account',
          containers: [{ containerId: 'cont1', name: 'My Container', publicId: 'GTM-XXXXX' }],
        },
      ],
    });
    vi.mocked(ihcApi.finalizeGtmConnection).mockResolvedValue({ connection_id: 'conn-001' });
    vi.mocked(ihcApi.getContainers)
      .mockResolvedValueOnce([]) // initial load
      .mockResolvedValueOnce([{
        id: 'conn-001', client_id: null, property_id: 'org-1', container_id: 'GTM-XXXXX',
        account_id: 'acct1', auth_method: 'oauth', last_synced_at: null, created_at: '2026-01-01T00:00:00Z',
      }]);

    renderSection('/settings/implementation-health/gtm/callback?code=abc&state=xyz');

    await waitFor(() => expect(screen.getByText('Choose a container to connect')).toBeTruthy());

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'acct1::cont1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect this container' }));

    await waitFor(() => expect(ihcApi.finalizeGtmConnection).toHaveBeenCalledWith('ref-1', 'acct1', 'cont1'));
    await waitFor(() => expect(screen.queryByText('Choose a container to connect')).toBeNull());
    expect(ihcApi.getContainers).toHaveBeenCalledTimes(2);
  });

  it('shows an error when discovery fails', async () => {
    vi.mocked(ihcApi.discoverGtmAccounts).mockRejectedValue(new Error('OAuth state expired (>10 min)'));

    renderSection('/settings/implementation-health/gtm/callback?code=abc&state=xyz');

    await waitFor(() => expect(screen.getByText('OAuth state expired (>10 min)')).toBeTruthy());
  });
});
