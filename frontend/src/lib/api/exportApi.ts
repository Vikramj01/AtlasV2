import { supabase } from '@/lib/supabase';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

async function getAuthHeader(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  return `Bearer ${session.access_token}`;
}

export const exportApi = {
  /**
   * Downloads the signal inventory XLSX and triggers a browser file save.
   * Pass orgId when in an org context to include org-specific signals.
   */
  downloadSignalInventory: async (orgId?: string): Promise<void> => {
    const authHeader = await getAuthHeader();
    const url = `${API_BASE}/api/exports/signal-inventory${orgId ? `?org_id=${encodeURIComponent(orgId)}` : ''}`;

    const res = await fetch(url, { headers: { Authorization: authHeader } });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? `Export failed: HTTP ${res.status}`);
    }

    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') ?? '';
    const filenameMatch = disposition.match(/filename="([^"]+)"/);
    const filename = filenameMatch?.[1] ?? 'atlas-signal-inventory.xlsx';

    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objectUrl);
  },
};
