/**
 * Developer Portal API client — unauthenticated.
 *
 * This client does NOT use the authenticated apiFetch. All requests go to
 * /api/dev/* endpoints which authenticate via the share token in the URL.
 * No Authorization header is sent.
 */

import type { DevPortalData } from '@/types/planning';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

async function devFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export const developerApi = {
  // GET /api/dev/:shareToken — full portal payload
  getDevPortal(shareToken: string): Promise<DevPortalData> {
    return devFetch(`/api/dev/${shareToken}`);
  },

  // PATCH /api/dev/:shareToken/pages/:pageId/status
  updatePageStatus(
    shareToken: string,
    pageId: string,
    status: string,
    developerNotes?: string,
  ): Promise<{ updated: boolean }> {
    return devFetch(`/api/dev/${shareToken}/pages/${pageId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, developer_notes: developerNotes }),
    });
  },

  // GET /api/dev/:shareToken/outputs/:outputId/download
  downloadOutput(shareToken: string, outputId: string): Promise<Blob> {
    return fetch(`${API_BASE}/api/dev/${shareToken}/outputs/${outputId}/download`).then((r) => {
      if (!r.ok) throw new Error(`Download failed: ${r.status}`);
      return r.blob();
    });
  },
};
