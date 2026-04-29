import { supabase } from '@/lib/supabase';
import type {
  CrawlMode,
  CrawlRunSummary,
  CrawlRunDetail,
  OrgPageScope,
} from '@/types/crawl';

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
    headers: { 'Content-Type': 'application/json', Authorization: authHeader, ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const crawlApi = {
  triggerCrawl: (mode: CrawlMode = 'onboarding') =>
    apiFetch<{ crawl_run_id: string; pages_queued: number }>('/api/crawl/trigger', {
      method: 'POST',
      body:   JSON.stringify({ mode }),
    }),

  seedPages: (urls: string[], source: 'google_ads' | 'meta_ads' | 'manual' = 'manual') =>
    apiFetch<{ seeded: number }>('/api/crawl/seed-pages', {
      method: 'POST',
      body:   JSON.stringify({ urls, source }),
    }),

  getRun: (crawl_run_id: string) =>
    apiFetch<CrawlRunDetail>(`/api/crawl/run/${crawl_run_id}`),

  getRuns: () =>
    apiFetch<CrawlRunSummary[]>('/api/crawl/runs'),

  getPageScope: () =>
    apiFetch<OrgPageScope[]>('/api/crawl/page-scope'),
};
