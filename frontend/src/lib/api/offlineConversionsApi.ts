/**
 * Offline Conversions Module — API Client
 *
 * All offline conversion API calls go through this module.
 * Follows the same pattern as capiApi.ts / consentApi.ts.
 */

import { supabase } from '@/lib/supabase';
import type {
  OfflineConversionConfig,
  CreateOfflineConfigInput,
  UpdateOfflineConfigInput,
  GoogleConversionAction,
  UploadValidationResponse,
  ConfirmUploadResponse,
  UploadDetailResponse,
  UploadHistoryResponse,
} from '@/types/offline-conversions';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

async function getAuthHeader(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  return `Bearer ${session.access_token}`;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const authHeader = await getAuthHeader();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader,
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string; message?: string };
    throw new Error(body.message ?? body.error ?? `Request failed: ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export const offlineConversionsApi = {

  // ── Configuration ─────────────────────────────────────────────────────────

  getConfig(): Promise<OfflineConversionConfig> {
    return apiFetch('/api/offline-conversions/config');
  },

  saveConfig(input: CreateOfflineConfigInput | UpdateOfflineConfigInput): Promise<OfflineConversionConfig> {
    return apiFetch('/api/offline-conversions/config', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  // ── Conversion actions ────────────────────────────────────────────────────

  /** Returns actions and the customer_id for the given Google CAPI provider. */
  listConversionActions(providerId: string): Promise<{ actions: GoogleConversionAction[]; customer_id: string }> {
    return apiFetch(`/api/offline-conversions/conversion-actions?provider_id=${encodeURIComponent(providerId)}`);
  },

  // ── Template ──────────────────────────────────────────────────────────────

  async downloadTemplate(): Promise<void> {
    const authHeader = await getAuthHeader();
    const res = await fetch(`${API_BASE}/api/offline-conversions/template`, {
      headers: { Authorization: authHeader },
    });
    if (!res.ok) throw new Error('Failed to download template');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'atlas-offline-conversions-template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  // ── Uploads (Sprint 4 — included here for completeness) ──────────────────

  async uploadCsv(file: File): Promise<UploadValidationResponse> {
    const authHeader = await getAuthHeader();
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API_BASE}/api/offline-conversions/upload`, {
      method: 'POST',
      headers: { Authorization: authHeader },
      body: formData,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string; message?: string };
      throw new Error(body.message ?? body.error ?? `Upload failed: ${res.status}`);
    }
    return res.json() as Promise<UploadValidationResponse>;
  },

  getUploadDetail(uploadId: string, page = 1, pageSize = 50): Promise<UploadDetailResponse> {
    return apiFetch(`/api/offline-conversions/upload/${uploadId}?page=${page}&page_size=${pageSize}`);
  },

  confirmUpload(uploadId: string): Promise<ConfirmUploadResponse> {
    return apiFetch(`/api/offline-conversions/upload/${uploadId}/confirm`, { method: 'POST' });
  },

  cancelUpload(uploadId: string): Promise<{ upload_id: string; status: string }> {
    return apiFetch(`/api/offline-conversions/upload/${uploadId}/cancel`, { method: 'POST' });
  },

  getHistory(page = 1, pageSize = 20): Promise<UploadHistoryResponse> {
    return apiFetch(`/api/offline-conversions/history?page=${page}&page_size=${pageSize}`);
  },
};
