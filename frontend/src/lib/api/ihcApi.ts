import { apiFetch } from './client';
import type {
  AuditFinding,
  FindingsSummary,
  GTMContainer,
  BaselineInfo,
  IHCPreferences,
} from '@/types/ihc';

// ── Findings ──────────────────────────────────────────────────────────────────

export async function getFindings(propertyId?: string): Promise<AuditFinding[]> {
  const qs = propertyId ? `?property_id=${propertyId}` : '';
  const res = await apiFetch<{ data: AuditFinding[] | null; upgrade_required?: boolean }>(
    `/ihc/findings${qs}`,
  );
  return res.data ?? [];
}

export async function getFindingsSummary(): Promise<FindingsSummary> {
  const res = await apiFetch<{ data: FindingsSummary }>('/ihc/findings/summary');
  return res.data;
}

// ── Baseline ──────────────────────────────────────────────────────────────────

export async function getBaseline(): Promise<BaselineInfo | null> {
  const res = await apiFetch<{ data: BaselineInfo | null }>('/ihc/baseline');
  return res.data;
}

export async function promoteBaseline(crawlRunId: string): Promise<void> {
  await apiFetch('/ihc/baseline', {
    method: 'POST',
    body: JSON.stringify({ crawl_run_id: crawlRunId }),
  });
}

// ── GTM Containers ────────────────────────────────────────────────────────────

export async function getContainers(): Promise<GTMContainer[]> {
  const res = await apiFetch<{ data: GTMContainer[] }>('/gtm/containers');
  return res.data ?? [];
}

export async function connectGTM(
  propertyId: string,
  clientId?: string,
): Promise<{ auth_url: string; state: string }> {
  const res = await apiFetch<{ data: { auth_url: string; state: string } }>('/gtm/connect', {
    method: 'POST',
    body: JSON.stringify({ property_id: propertyId, client_id: clientId }),
  });
  return res.data;
}

export async function uploadContainerJSON(
  propertyId: string,
  containerJson: Record<string, unknown>,
  clientId?: string,
): Promise<{ connection_id: string; snapshot_id: string; tag_count: number; trigger_count: number }> {
  const res = await apiFetch<{
    data: { connection_id: string; snapshot_id: string; tag_count: number; trigger_count: number };
  }>('/gtm/upload', {
    method: 'POST',
    body: JSON.stringify({ property_id: propertyId, container_json: containerJson, client_id: clientId }),
  });
  return res.data;
}

export async function disconnectContainer(connectionId: string): Promise<void> {
  await apiFetch(`/gtm/containers/${connectionId}`, { method: 'DELETE' });
}

// ── Preferences ───────────────────────────────────────────────────────────────

export async function getPreferences(): Promise<IHCPreferences | null> {
  try {
    const res = await apiFetch<{ data: IHCPreferences | null }>('/ihc/preferences');
    return res.data;
  } catch {
    return null;
  }
}

export async function savePreferences(prefs: Partial<IHCPreferences>): Promise<void> {
  await apiFetch('/ihc/preferences', {
    method: 'PATCH',
    body: JSON.stringify(prefs),
  });
}

export const ihcApi = {
  getFindings,
  getFindingsSummary,
  getBaseline,
  promoteBaseline,
  getContainers,
  connectGTM,
  uploadContainerJSON,
  disconnectContainer,
  getPreferences,
  savePreferences,
};
