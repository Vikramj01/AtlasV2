/**
 * Google Tag Topology UI (Sprint 4). Plain DOM assertions, not jest-dom
 * matchers — same convention as the other component tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('@/lib/api/googleTagTopologyApi', () => ({
  googleTagTopologyApi: {
    getTopology: vi.fn(),
    declare: vi.fn(),
    listContainers: vi.fn(),
    planSplit: vi.fn(),
    deploySplit: vi.fn(),
    verifySplit: vi.fn(),
    downloadSplit: vi.fn(),
  },
}));

import { googleTagTopologyApi } from '@/lib/api/googleTagTopologyApi';
import { GoogleTagTopologyCard } from './GoogleTagTopologyCard';
import { GoogleTagSplitFlow } from './GoogleTagSplitFlow';
import type { GoogleTagTopology, SplitPlanResponse } from '@/types/googleTagTopology';

const api = vi.mocked(googleTagTopologyApi);

const topology = (over: Partial<GoogleTagTopology>): GoogleTagTopology => ({
  verdict: 'UNKNOWN', strength: 'none', combined_tags: [], destination_count: 0, current: [], history: [], ...over,
});

const plan = (over: Partial<SplitPlanResponse> = {}): SplitPlanResponse => ({
  plan_id: null,
  delta: { containerVersion: {} },
  diff: { tags_added: ['Google Tag - Google Ads'], variables_added: ['CONST - Google Ads Conversion ID'], triggers_added: ['Atlas - Google tag split - All Pages'], already_covered: [] },
  conflicts: [],
  destinations: { ga4: 'G-1', google_ads: 'AW-1' },
  guidance: [
    { step: 1, title: 'Check you can edit the Google tag itself', body: 'You may need admin access on the Google tag itself.', evidence: 'unverified' },
    { step: 2, title: 'Review the draft', body: 'Review it.', evidence: 'verified' },
  ],
  topology: { verdict: 'UNKNOWN', strength: 'none', combined_tags: [], destination_count: 0 },
  can_deploy_draft: true,
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('GoogleTagTopologyCard', () => {
  it('UNKNOWN shows "Needs confirmation", an empty state and the split planner button', async () => {
    api.getTopology.mockResolvedValue(topology({}));
    render(<GoogleTagTopologyCard orgId="o" clientId="c" />);
    await waitFor(() => expect(screen.getByText('Not known yet')).toBeTruthy());
    expect(screen.getByText('Needs confirmation')).toBeTruthy();
    expect(screen.getByText(/Nothing observed yet/)).toBeTruthy();
    expect(screen.getByText('Plan a split')).toBeTruthy();
  });

  it('a client-confirmed COMBINED_ADS_PRIMARY marks the primary ID and has no "Needs confirmation"', async () => {
    api.getTopology.mockResolvedValue(topology({
      verdict: 'COMBINED_ADS_PRIMARY', strength: 'declared',
      combined_tags: [{ google_tag_id: 'AW-1', primary_destination_id: 'AW-1', destination_ids: ['AW-1', 'G-1'] }],
      current: [{ id: 'r1', google_tag_id: 'AW-1', primary_destination_id: 'AW-1', destination_ids: ['AW-1', 'G-1'], source: 'operator_declared', declaration_source: 'CLIENT_CONFIRMED', evidence_class: 'DIRECT', observed_at: '', is_current: true }],
    }));
    render(<GoogleTagTopologyCard orgId="o" clientId="c" />);
    await waitFor(() => expect(screen.getByText('Combined, Google Ads is the primary ID')).toBeTruthy());
    expect(screen.getByText('AW-1 · primary')).toBeTruthy();
    expect(screen.getByText(/Consent settings configured on a combined Google tag can apply to every destination/)).toBeTruthy();
    expect(screen.queryByText('Needs confirmation')).toBeNull();
  });

  it('a runtime co-occurrence hint is labelled as such and needs confirmation', async () => {
    api.getTopology.mockResolvedValue(topology({
      verdict: 'COMBINED', strength: 'assumed',
      current: [{ id: 'r1', google_tag_id: 'G-1', primary_destination_id: 'G-1', destination_ids: ['G-1', 'AW-1'], source: 'runtime_observed', inferred: true, evidence_class: 'INFERRED', observed_at: '', is_current: true }],
    }));
    render(<GoogleTagTopologyCard orgId="o" clientId="c" />);
    await waitFor(() => expect(screen.getByText('From co-occurrence only')).toBeTruthy());
    expect(screen.getByText('Needs confirmation')).toBeTruthy();
  });

  it('SPLIT hides the split planner and the combined-tag consent note', async () => {
    api.getTopology.mockResolvedValue(topology({ verdict: 'SPLIT', strength: 'observed' }));
    render(<GoogleTagTopologyCard orgId="o" clientId="c" />);
    await waitFor(() => expect(screen.getByText('One Google tag per destination')).toBeTruthy());
    expect(screen.queryByText('Plan a split')).toBeNull();
    expect(screen.queryByText(/Consent settings configured on a combined Google tag/)).toBeNull();
  });

  it('submits a declaration with parsed destination IDs', async () => {
    api.getTopology.mockResolvedValue(topology({}));
    api.declare.mockResolvedValue({ verdict: 'COMBINED', strength: 'assumed', combined_tags: [], destination_count: 2 });
    const { container } = render(<GoogleTagTopologyCard orgId="o" clientId="c" />);
    await waitFor(() => expect(screen.getByText('Save')).toBeTruthy());
    const inputs = container.querySelectorAll('input');
    fireEvent.change(inputs[0], { target: { value: 'G-1' } });
    fireEvent.change(inputs[1], { target: { value: 'G-1, AW-9' } });
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(api.declare).toHaveBeenCalledTimes(1));
    expect(api.declare).toHaveBeenCalledWith('o', 'c', { google_tag_id: 'G-1', destination_ids: ['G-1', 'AW-9'], declaration_source: 'OPERATOR_ASSUMED' });
  });
});

describe('GoogleTagSplitFlow', () => {
  const container = { id: 'conn-1', client_id: 'c', property_id: 'p', container_id: 'GTM-1', account_id: 'a', auth_method: 'oauth' as const, last_synced_at: null, created_at: '' };

  it('says so when the client has no GTM container connected', async () => {
    api.listContainers.mockResolvedValue([{ ...container, client_id: 'someone-else' }]);
    render(<GoogleTagSplitFlow clientId="c" />);
    await waitFor(() => expect(screen.getByText(/no GTM container connected/)).toBeTruthy());
  });

  it('builds a plan, flags the unverified guidance step, and requires a confirmation before deploying a draft', async () => {
    api.listContainers.mockResolvedValue([container]);
    api.planSplit.mockResolvedValue(plan());
    render(<GoogleTagSplitFlow clientId="c" />);
    await waitFor(() => expect(screen.getByText('Build split plan')).toBeTruthy());
    fireEvent.click(screen.getByText('Build split plan'));
    await waitFor(() => expect(screen.getByText('Google Tag - Google Ads')).toBeTruthy());
    expect(screen.getByText('Needs confirmation')).toBeTruthy(); // step 1 only
    expect(screen.getAllByText('Needs confirmation')).toHaveLength(1);

    fireEvent.click(screen.getByText('Deploy as GTM draft'));
    expect(api.deploySplit).not.toHaveBeenCalled(); // first click only asks for confirmation
    expect(screen.getByText(/Create a new draft workspace in this container/)).toBeTruthy();

    api.deploySplit.mockResolvedValue({ plan_id: 'p1', status: 'deployed_draft', workspace_id: 'w', workspace_url: 'https://tagmanager.google.com/x', tags_created: 1 });
    fireEvent.click(screen.getByText('Create draft'));
    await waitFor(() => expect(screen.getByText(/Draft created/)).toBeTruthy());
    expect(api.deploySplit).toHaveBeenCalledWith('conn-1', undefined);
  });

  it('shows conflicts instead of a deploy button', async () => {
    api.listContainers.mockResolvedValue([container]);
    api.planSplit.mockResolvedValue(plan({
      delta: null,
      diff: { tags_added: [], variables_added: [], triggers_added: [], already_covered: [] },
      conflicts: [{ code: 'name_conflict', message: 'A tag named "X" already exists.' }],
      can_deploy_draft: false,
    }));
    render(<GoogleTagSplitFlow clientId="c" />);
    await waitFor(() => expect(screen.getByText('Build split plan')).toBeTruthy());
    fireEvent.click(screen.getByText('Build split plan'));
    await waitFor(() => expect(screen.getByText(/A tag named "X" already exists/)).toBeTruthy());
    expect(screen.queryByText('Deploy as GTM draft')).toBeNull();
  });

  it('manual-upload containers get the download path and an explanation, not a deploy button', async () => {
    api.listContainers.mockResolvedValue([{ ...container, auth_method: 'manual_upload' }]);
    api.planSplit.mockResolvedValue(plan({ can_deploy_draft: false }));
    render(<GoogleTagSplitFlow clientId="c" />);
    await waitFor(() => expect(screen.getByText('Build split plan')).toBeTruthy());
    fireEvent.click(screen.getByText('Build split plan'));
    await waitFor(() => expect(screen.getByText('Download import file')).toBeTruthy());
    expect(screen.queryByText('Deploy as GTM draft')).toBeNull();
    expect(screen.getByText(/connected by manual upload/)).toBeTruthy();
  });

  it('passes an operator-entered split date through to verification', async () => {
    api.listContainers.mockResolvedValue([container]);
    api.planSplit.mockResolvedValue(plan());
    api.deploySplit.mockResolvedValue({ plan_id: 'p1', status: 'deployed_draft', workspace_id: 'w', workspace_url: 'https://x', tags_created: 1 });
    api.verifySplit.mockResolvedValue({ plan_id: 'p1', status: 'deployed_draft', verified: false, reasons: ['x'], topology: { verdict: 'UNKNOWN', strength: 'none', combined_tags: [], destination_count: 0 } });
    const { container: dom } = render(<GoogleTagSplitFlow clientId="c" />);
    await waitFor(() => expect(screen.getByText('Build split plan')).toBeTruthy());
    fireEvent.click(screen.getByText('Build split plan'));
    await waitFor(() => expect(screen.getByText('Deploy as GTM draft')).toBeTruthy());
    fireEvent.click(screen.getByText('Deploy as GTM draft'));
    fireEvent.click(screen.getByText('Create draft'));
    await waitFor(() => expect(screen.getByText('Verify the split')).toBeTruthy());
    fireEvent.change(dom.querySelector('input[type="date"]')!, { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByText('Verify the split'));
    await waitFor(() => expect(api.verifySplit).toHaveBeenCalledWith('p1', '2026-10-01'));
  });

  it('a failed verification lists what still fails; a verified one says so', async () => {
    api.listContainers.mockResolvedValue([container]);
    api.planSplit.mockResolvedValue(plan());
    api.deploySplit.mockResolvedValue({ plan_id: 'p1', status: 'deployed_draft', workspace_id: 'w', workspace_url: 'https://x', tags_created: 1 });
    api.verifySplit.mockResolvedValue({ plan_id: 'p1', status: 'deployed_draft', verified: false, reasons: ['No container snapshot has been taken since the draft was created.'], topology: { verdict: 'UNKNOWN', strength: 'none', combined_tags: [], destination_count: 0 } });
    render(<GoogleTagSplitFlow clientId="c" />);
    await waitFor(() => expect(screen.getByText('Build split plan')).toBeTruthy());
    fireEvent.click(screen.getByText('Build split plan'));
    await waitFor(() => expect(screen.getByText('Deploy as GTM draft')).toBeTruthy());
    fireEvent.click(screen.getByText('Deploy as GTM draft'));
    fireEvent.click(screen.getByText('Create draft'));
    await waitFor(() => expect(screen.getByText('Verify the split')).toBeTruthy());
    fireEvent.click(screen.getByText('Verify the split'));
    await waitFor(() => expect(screen.getByText('Not verified yet')).toBeTruthy());
    expect(screen.getByText(/No container snapshot/)).toBeTruthy();
    expect(api.verifySplit).toHaveBeenLastCalledWith('p1', undefined); // no split date entered

    api.verifySplit.mockResolvedValue({ plan_id: 'p1', status: 'verified', verified: true, reasons: [], topology: { verdict: 'SPLIT', strength: 'observed', combined_tags: [], destination_count: 2 } });
    fireEvent.click(screen.getByText('Verify the split'));
    await waitFor(() => expect(screen.getByText(/Verified: the Google tags are split/)).toBeTruthy());
  });
});
