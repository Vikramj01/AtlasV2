import type { PublicAuditRun, SubmitAuditResponse } from '@/types/publicAudit';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

async function publicFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Request failed: ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export const publicAuditApi = {
  submitAudit(url: string): Promise<SubmitAuditResponse> {
    return publicFetch('/api/public/audit', {
      method: 'POST',
      body:   JSON.stringify({ url }),
    });
  },

  pollAudit(token: string): Promise<{ data: PublicAuditRun }> {
    return publicFetch(`/api/public/audit/${token}`);
  },

  captureEmail(token: string, email: string): Promise<{ data: { ok: boolean } }> {
    return publicFetch(`/api/public/audit/${token}/email`, {
      method: 'POST',
      body:   JSON.stringify({ email }),
    });
  },
};
