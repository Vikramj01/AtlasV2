/** HeldConversionsTab (junk gate C2): plain DOM assertions, like the other component tests. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('@/lib/api/junkGateApi', () => ({
  junkGateApi: { getMetrics: vi.fn(), getConfig: vi.fn(), saveConfig: vi.fn(), listHolds: vi.fn(), release: vi.fn(), reject: vi.fn(), bulk: vi.fn() },
}));
vi.mock('@/lib/api/organisationApi', () => ({ clientApi: { list: vi.fn() } }));
vi.mock('@/store/organisationStore', () => ({ useOrganisationStore: () => ({ currentOrg: { id: 'org-1' } }) }));

import { junkGateApi } from '@/lib/api/junkGateApi';
import { clientApi } from '@/lib/api/organisationApi';
import { HeldConversionsTab } from './HeldConversionsTab';
import type { HeldConversion, JunkGateConfigView, JunkGateMetrics } from '@/types/junkGate';

const api = vi.mocked(junkGateApi);

const cfg = (over: Partial<JunkGateConfigView['config']> = {}): JunkGateConfigView => ({
  config: {
    mode: 'enforce', event_names: [], action_junk: 'hold', action_suspect: 'hold', hold_timeout_hours: 24, timeout_action: 'release',
    hold_rate_alert_pct: 30,
    thresholds: { duplicate_window_minutes: 10, velocity_max: 5, velocity_window_minutes: 60, suspect_soft_hits: 2, min_submit_ms: 2000 },
    ...over,
  },
  saved: true, hold_ceiling_hours: 156, timeout_will_clamp: false,
});

const hold = (over: Partial<HeldConversion> = {}): HeldConversion => ({
  id: 'h1', client_id: 'c1', event_name: 'generate_lead', event_time: '2026-10-07T10:00:00Z', verdict: 'junk', status: 'held',
  rule_hits: [{ rule_id: 'JC_EMAIL_DISPOSABLE', class: 'soft', evidence: 'e-mail domain is on the disposable-domain list (mailinator.com)' }],
  delivery_class: 'hybrid', expires_at: null, seconds_remaining: 7200, timeout_hours_applied: 24, timeout_clamped: false,
  decided_at: null, created_at: '2026-10-07T10:00:00Z', would_have_held: false, ...over,
});

const metrics = (over: Partial<JunkGateMetrics> = {}): JunkGateMetrics => ({
  window_days: 30, evaluated: 200, flagged: 40, flagged_rate: 0.2, held: 30, hold_rate: 0.15, open_held: 2, auto_released: 3, auto_dropped: 1,
  reviewed_released: 8, reviewed_rejected: 16, overturn_rate: 8 / 24, truncated: false,
  rules: [
    { rule_id: 'JC_EMAIL_DISPOSABLE', hits: 25, hit_rate: 0.125, reviewed: 10, overturned: 8, overturn_rate: 0.8, likely_holding_good_leads: true },
    { rule_id: 'JC_NON_HUMAN_UA', hits: 15, hit_rate: 0.075, reviewed: 14, overturned: 0, overturn_rate: 0, likely_holding_good_leads: false },
  ],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  api.getMetrics.mockResolvedValue(metrics());
  vi.mocked(clientApi.list).mockResolvedValue([{ id: 'c1', name: 'Acme' }] as never);
  api.getConfig.mockResolvedValue(cfg());
});

describe('HeldConversionsTab', () => {
  it('lists held conversions with the rule evidence, time left, and the hybrid explanation', async () => {
    api.listHolds.mockResolvedValue({ holds: [hold()], total: 1 });
    render(<HeldConversionsTab />);
    await waitFor(() => expect(screen.getByText('generate_lead')).toBeTruthy());
    expect(screen.getAllByText('JC_EMAIL_DISPOSABLE').length).toBeGreaterThan(0);
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

  it('shows real metrics and flags a rule reviewers often release', async () => {
    api.listHolds.mockResolvedValue({ holds: [hold()], total: 1 });
    render(<HeldConversionsTab />);
    await waitFor(() => expect(screen.getByText('Last 30 days')).toBeTruthy());
    expect(screen.getByText(/200 conversions evaluated/)).toBeTruthy();
    expect(screen.getByText('15%')).toBeTruthy(); // hold rate
    expect(screen.getByText('Often released — may hold good leads')).toBeTruthy();
    // the queue row carrying that rule is flagged too
    await waitFor(() => expect(screen.getByText('(often released on review)')).toBeTruthy());
    expect(api.getMetrics).toHaveBeenCalledWith('c1', 30);
  });

  it('a rule with no flag and an empty window render honestly (no fabricated figures)', async () => {
    api.getMetrics.mockResolvedValue(metrics({ evaluated: 0, flagged_rate: null, hold_rate: null, overturn_rate: null, rules: [] }));
    api.listHolds.mockResolvedValue({ holds: [], total: 0 });
    render(<HeldConversionsTab />);
    await waitFor(() => expect(screen.getByText('No rule has fired in this window.')).toBeTruthy());
    expect(screen.queryByText('Often released — may hold good leads')).toBeNull();
  });

  it('a metrics failure never breaks the queue', async () => {
    api.getMetrics.mockRejectedValue(new Error('boom'));
    api.listHolds.mockResolvedValue({ holds: [hold()], total: 1 });
    render(<HeldConversionsTab />);
    await waitFor(() => expect(screen.getByText('generate_lead')).toBeTruthy());
    expect(screen.queryByText('Last 30 days')).toBeNull();
  });

  it('saving settings sends the new alert threshold and the full thresholds object', async () => {
    api.listHolds.mockResolvedValue({ holds: [], total: 0 });
    api.saveConfig.mockResolvedValue(cfg());
    render(<HeldConversionsTab />);
    await waitFor(() => screen.getByText('Gate settings'));
    const alertInput = screen.getByDisplayValue('30') as HTMLInputElement;
    fireEvent.change(alertInput, { target: { value: '45' } });
    fireEvent.click(screen.getByText('Save settings'));
    await waitFor(() => expect(api.saveConfig).toHaveBeenCalled());
    const patch = api.saveConfig.mock.calls[0][1] as Record<string, unknown>;
    expect(patch.hold_rate_alert_pct).toBe(45);
    expect(patch.thresholds).toMatchObject({ min_submit_ms: 2000, velocity_max: 5 });
  });
});
