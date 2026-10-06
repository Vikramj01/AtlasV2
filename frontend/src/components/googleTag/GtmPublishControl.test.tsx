import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const publishToGtm = vi.fn();
const rollbackGtmPublish = vi.fn();
vi.mock('@/lib/api/ihcApi', () => ({ ihcApi: { publishToGtm: (...a: unknown[]) => publishToGtm(...a), rollbackGtmPublish: (...a: unknown[]) => rollbackGtmPublish(...a) } }));

import { GtmPublishControl } from './GtmPublishControl';
import type { GTMContainer } from '@/types/ihc';

const conn = (over: Partial<GTMContainer> = {}): GTMContainer => ({
  id: 'conn-1', client_id: 'c', property_id: 'p', container_id: 'C1', account_id: 'a', auth_method: 'oauth', last_synced_at: null, created_at: '', can_deploy: true, can_publish: true, ...over,
});

beforeEach(() => { vi.clearAllMocks(); });

describe('GtmPublishControl', () => {
  it('renders nothing for a manual-upload connection or no connection', () => {
    expect(render(<GtmPublishControl connection={conn({ auth_method: 'manual_upload' })} workspaceId="9" />).container.textContent).toBe('');
    expect(render(<GtmPublishControl connection={undefined} workspaceId="9" />).container.textContent).toBe('');
  });

  it('an old-scope connection shows the reconnect message and no publish button', () => {
    render(<GtmPublishControl connection={conn({ can_publish: false })} workspaceId="9" />);
    expect(screen.getByText(/Reconnect the container/)).not.toBeNull();
    expect(screen.queryByText('Publish to live container')).toBeNull();
  });

  it('the publish button stays disabled until the live-change confirmation is ticked, and sends nothing before that', () => {
    render(<GtmPublishControl connection={conn()} workspaceId="9" />);
    const button = screen.getByText('Publish to live container') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(publishToGtm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(button.disabled).toBe(false);
  });

  it('publishes the confirmed workspace, then offers rollback of that publish', async () => {
    publishToGtm.mockResolvedValue({ log_id: 'log-1', published_version_id: '42', previous_version_id: '41', rollback_available: true, snapshot_queued: true });
    rollbackGtmPublish.mockResolvedValue({ restored_version_id: '41' });
    render(<GtmPublishControl connection={conn()} workspaceId="9" />);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('Publish to live container'));
    await waitFor(() => expect(screen.getByText('Published to the live container.')).not.toBeNull());
    expect(publishToGtm).toHaveBeenCalledWith('conn-1', '9');
    fireEvent.click(screen.getByText('Roll back to the previous version'));
    await waitFor(() => expect(screen.getByText(/Rolled back/)).not.toBeNull());
    expect(rollbackGtmPublish).toHaveBeenCalledWith('log-1');
  });

  it('says honestly when no rollback is available (first-ever publish)', async () => {
    publishToGtm.mockResolvedValue({ log_id: 'log-1', published_version_id: '42', previous_version_id: null, rollback_available: false, snapshot_queued: true });
    render(<GtmPublishControl connection={conn()} workspaceId="9" />);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('Publish to live container'));
    await waitFor(() => expect(screen.getByText(/No rollback is available from Atlas/)).not.toBeNull());
    expect(screen.queryByText('Roll back to the previous version')).toBeNull();
  });

  it('surfaces a refusal message and leaves the control usable', async () => {
    publishToGtm.mockRejectedValue(new Error('Tag Manager reports compiler errors in this workspace. Nothing was published.'));
    render(<GtmPublishControl connection={conn()} workspaceId="9" />);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('Publish to live container'));
    await waitFor(() => expect(screen.getByText(/compiler errors/)).not.toBeNull());
    expect(screen.getByText('Publish to live container')).not.toBeNull();
  });
});
