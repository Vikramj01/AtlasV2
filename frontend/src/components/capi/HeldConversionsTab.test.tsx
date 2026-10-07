/** HeldConversionsTab (junk gate C2): plain DOM assertions, like the other component tests. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('@/lib/api/junkGateApi', () => ({
  junkGateApi: { getConfig: vi.fn(), saveConfig: vi.fn(), listHolds: vi.fn(), release: vi.fn(), reject: vi.fn(), bulk: vi.fn() },
}));
vi.mock('@/lib/api/organisationApi', () => ({ clientApi: { list: vi.fn() } }));
vi.mock('@/store/organisationStore', () => ({ useOrganisationStore: () => ({ currentOrg: { id: 'org-1' } }) }));

import { junkGateApi } from '@/lib/api/junkGateApi';
import { clientApi } from '@/lib/api/organisationApi';
import { HeldConversionsTab } from './HeldConversionsTab';
import type { HeldConversion, JunkGateConfigView } from '@/types/junkGate';

const api = vi.mocked(junkGateApi);

const cfg = (over: Partial<JunkGateConfigView['config']> = {}): JunkGateConfigView => ({
  config: { mode: 'enforce', event_names: [], action_junk: 'hold', action_suspect: 'hold', hold_timeout_hours: 24, timeout_action: 'release', ...over },
  saved: true, hold_ceiling_hours: 156, timeout_will_clamp: false,
});

const hold = (over: Partial<HeldConversion> = {}): HeldConversion => ({
  id: 'h1', client_id: 'c1', event_name: 'generate_lead', event_time: '2026-10-07T10:00:00Z', verdict: 'junk', status: 'held',
  rule_hits: [{ rule_id: 'JC_EMAIL_DISPOSABLE', class: 'soft', evidence: 'e-mail domain is on the disposable-domain list (mailinator.com)' }],
  delivery_class: 'hybrid', expires_at: null, seconds_remaining: 7200, timeout_hours_applied: 24, timeout_clamped: false,
  decided_at: null, created_at: '2026-10-07T10:00:00Z', would_have_held: false, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(clientApi.list).mockResolvedValue([{ id: 'c1', name: 'Acme' }] as never);
  api.getConfig.mockResolvedValue(cfg());
});

describe('HeldConversionsTab', () => {
  it('lists held conversions with the rule evidence, time left, and the hybrid explanation', async () => {
    api.listHolds.mockResolvedValue({ holds: [hold()], total: 1 });
    render(<HeldConversionsTab />);
    await waitFor(() => expect(screen.getByText('generate_lead')).toBeTruthy());
    expect(screen.getByText('JC_EMAIL_DISPOSABLE')).toBeTruthy();
    expect(screen.getByText(/disposable-domain list/)).toBeTruthy();
    expect(screen.getByText('Hybrid')).toBeTruthy();
    expect(screen.getByText(/the platform can still receive the browser event/)).toBeTruthy();
    expect(screen.getByText('2h 0m')).toBeTruthy();
    expect(api.listHolds).toHaveBeenCalledWith(expect.objectContaining({ client_id: 'c1', status: ['held'] }));
  });

  it('a server-only row is labelled so and carries no hybrid warning', async () => {
    api.listHolds.mockResolvedValue({ holds: [hold({ delivery_class: 'server_only' })], total: 1 });
    render(<HeldConversionsTab />);
    await waitFor(() => expect(screen.getByText('Server-only')).toBeTruthy());
    expect(screen.queryByText(/can still receive the browser event/)).toBeNull();
  });

  it('release calls the bulk endpoint with that one id, then reloads', async () => {
    api.listHolds.mockResolvedValue({ holds: [hold()], total: 1 });
    api.bulk.mockResolvedValue({ done: 1, results: [] });
    render(<HeldConversionsTab />);
    await waitFor(() => screen.getByText('Release'));
    fireEvent.click(screen.getByText('Release'));
    await waitFor(() => expect(api.bulk).toHaveBeenCalledWith(['h1'], 'release'));
    await waitFor(() => expect(api.listHolds.mock.calls.length).toBeGreaterThan(1));
  });

  it('bulk reject sends every selected id', async () => {
    api.listHolds.mockResolvedValue({ holds: [hold(), hold({ id: 'h2' })], total: 2 });
    api.bulk.mockResolvedValue({ done: 2, results: [] });
    render(<HeldConversionsTab />);
    await waitFor(() => screen.getAllByLabelText('Select conversion'));
    fireEvent.click(screen.getByLabelText('Select all'));
    fireEvent.click(screen.getByText('Reject selected'));
    await waitFor(() => expect(api.bulk).toHaveBeenCalledWith(['h1', 'h2'], 'reject'));
  });

  it('the observe-mode log is read-only: no release / reject controls', async () => {
    api.getConfig.mockResolvedValue(cfg({ mode: 'observe' }));
    api.listHolds.mockResolvedValue({ holds: [hold({ status: 'observed', would_have_held: true, seconds_remaining: null })], total: 1 });
    render(<HeldConversionsTab />);
    await waitFor(() => screen.getByText('generate_lead'));
    fireEvent.click(screen.getByText('Would have held'));
    await waitFor(() => expect(api.listHolds).toHaveBeenLastCalledWith(expect.objectContaining({ status: ['observed'] })));
    expect(screen.queryByText('Release')).toBeNull();
    expect(screen.queryByText('Reject')).toBeNull();
    expect(screen.getByText(/Nothing was held/)).toBeTruthy();
  });

  it('shows the destination-window cap and the clamp warning when the saved timeout exceeds it', async () => {
    api.getConfig.mockResolvedValue({ ...cfg({ hold_timeout_hours: 72 }), hold_ceiling_hours: 36, timeout_will_clamp: true });
    api.listHolds.mockResolvedValue({ holds: [], total: 0 });
    render(<HeldConversionsTab />);
    await waitFor(() => expect(screen.getByText(/capped at 36 hours/)).toBeTruthy());
    expect(screen.getByText(/shortened to this cap/)).toBeTruthy();
  });

  it('an empty queue says so instead of rendering an empty table', async () => {
    api.listHolds.mockResolvedValue({ holds: [], total: 0 });
    render(<HeldConversionsTab />);
    await waitFor(() => expect(screen.getByText('Nothing is being held for review.')).toBeTruthy());
  });
});
