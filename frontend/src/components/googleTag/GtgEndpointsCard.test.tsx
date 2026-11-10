/**
 * GtgEndpointsCard (Google tag gateway, Sprint 3). Plain DOM assertions, not
 * jest-dom matchers — same convention as the other component tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('@/lib/api/gtgApi', () => ({
  gtgApi: { getOverview: vi.fn(), addEndpoint: vi.fn(), removeEndpoint: vi.fn(), verify: vi.fn() },
}));

import { gtgApi, type GtgEndpoint, type GtgOverview } from '@/lib/api/gtgApi';
import { GtgEndpointsCard } from './GtgEndpointsCard';

const api = vi.mocked(gtgApi);

const endpoint = (over: Partial<GtgEndpoint> = {}): GtgEndpoint => ({
  id: 'ep-1', hostname: 'www.example.com', reserved_path: '/metrics', tag_or_container: 'GTM-ABC1234',
  source: 'operator_declared', is_verified: false, geo_verified: false, verified_at: null,
  probe_urls: { healthy: 'https://www.example.com/metrics/healthy', geo: 'https://www.example.com/metrics/?validate_geo=healthy' },
  ...over,
});

const overview = (over: Partial<GtgOverview> = {}): GtgOverview => ({
  status: 'unknown', status_updated_at: null, went_live_at: null, capture_status: 'unknown', probe_status: 'none',
  probe_checked_at: null, endpoints: [], recent_checks: [], max_endpoints: 10, ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('GtgEndpointsCard', () => {
  it('shows the honest status and an empty-state with no registered path', async () => {
    api.getOverview.mockResolvedValue(overview());
    render(<GtgEndpointsCard orgId="o" clientId="c" />);
    await waitFor(() => expect(screen.getByText('Not checked')).toBeTruthy());
    expect(screen.getByText(/No gateway path registered/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Verify now' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('never claims an uplift figure', async () => {
    api.getOverview.mockResolvedValue(overview({ status: 'verified', endpoints: [endpoint({ is_verified: true, geo_verified: true })] }));
    const { container } = render(<GtgEndpointsCard orgId="o" clientId="c" />);
    await waitFor(() => expect(screen.getAllByText('Verified').length).toBeGreaterThan(0)); // status chip + the endpoint chip
    expect(container.textContent).not.toMatch(/11\s*%|uplift/i);
  });

  it('states what each registered path is: source, verification and location-header state', async () => {
    api.getOverview.mockResolvedValue(overview({
      status: 'verified_no_geo',
      endpoints: [
        endpoint({ id: 'a', reserved_path: '/metrics', is_verified: true, geo_verified: false }),
        endpoint({ id: 'b', reserved_path: '/gw', source: 'detected' }),
      ],
    }));
    render(<GtgEndpointsCard orgId="o" clientId="c" />);
    await waitFor(() => expect(screen.getByText('www.example.com/metrics')).toBeTruthy());
    expect(screen.getAllByText('Routes, no location headers').length).toBeGreaterThan(0);
    expect(screen.getByText('Not verified')).toBeTruthy();
    expect(screen.getByText(/Detected on the site/)).toBeTruthy();
  });

  it('Verify now calls the API and renders each endpoint verdict, then refreshes', async () => {
    api.getOverview.mockResolvedValue(overview({ endpoints: [endpoint()] }));
    api.verify.mockResolvedValue({
      status: 'broken', probe_status: 'broken', probe_checked_at: null,
      results: [{ endpoint_id: 'ep-1', path_status: 'fail', geo_status: 'skipped', verdict: 'broken', http_status: 404, response_ms: 40, message: 'HTTP 404' }],
    });
    render(<GtgEndpointsCard orgId="o" clientId="c" />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Verify now' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Verify now' }));
    await waitFor(() => expect(screen.getByText(/Failed its health check/)).toBeTruthy());
    expect(api.verify).toHaveBeenCalledWith('o', 'c');
    expect(api.getOverview).toHaveBeenCalledTimes(2);
  });

  it('registers a path, clears the form and reloads', async () => {
    api.getOverview.mockResolvedValue(overview());
    api.addEndpoint.mockResolvedValue(endpoint());
    render(<GtgEndpointsCard orgId="o" clientId="c" />);
    await waitFor(() => expect(screen.getByPlaceholderText('/metrics')).toBeTruthy());

    fireEvent.change(screen.getByPlaceholderText('www.example.com'), { target: { value: 'www.example.com' } });
    fireEvent.change(screen.getByPlaceholderText('/metrics'), { target: { value: '/metrics' } });
    fireEvent.change(screen.getByPlaceholderText('GTM-XXXXXXX'), { target: { value: 'GTM-ABC1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save path' }));

    await waitFor(() => expect(api.addEndpoint).toHaveBeenCalledWith('o', 'c', {
      hostname: 'www.example.com', reserved_path: '/metrics', tag_or_container: 'GTM-ABC1234',
    }));
    await waitFor(() => expect((screen.getByPlaceholderText('/metrics') as HTMLInputElement).value).toBe(''));
  });

  it('shows the server validation message when a path is rejected', async () => {
    api.getOverview.mockResolvedValue(overview());
    api.addEndpoint.mockRejectedValue(new Error("Hostname must belong to this client's site (example.com)"));
    render(<GtgEndpointsCard orgId="o" clientId="c" />);
    await waitFor(() => expect(screen.getByPlaceholderText('/metrics')).toBeTruthy());
    for (const [ph, v] of [['www.example.com', 'evil.com'], ['/metrics', '/m'], ['GTM-XXXXXXX', 'GTM-ABC1234']] as const) {
      fireEvent.change(screen.getByPlaceholderText(ph), { target: { value: v } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Save path' }));
    await waitFor(() => expect(screen.getByText(/must belong to this client/)).toBeTruthy());
  });

  it('removes a path and reloads', async () => {
    api.getOverview.mockResolvedValue(overview({ endpoints: [endpoint()] }));
    api.removeEndpoint.mockResolvedValue({ removed: true });
    render(<GtgEndpointsCard orgId="o" clientId="c" />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove /metrics' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Remove /metrics' }));
    await waitFor(() => expect(api.removeEndpoint).toHaveBeenCalledWith('o', 'c', 'ep-1'));
  });

  it('shows a load error without crashing', async () => {
    api.getOverview.mockRejectedValue(new Error('boom'));
    render(<GtgEndpointsCard orgId="o" clientId="c" />);
    await waitFor(() => expect(screen.getByText('boom')).toBeTruthy());
  });
});
