import { supabase } from '@/lib/supabase';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

async function getAuthHeader(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  return `Bearer ${session.access_token}`;
}

export interface ReadinessItem {
  key: string;
  label: string;
  description: string;
  points: number;
  earned: boolean;
  link: string;
}

export interface ReadinessScore {
  score: number;
  level: 'getting_started' | 'building' | 'strong' | 'best_in_class';
  level_label: string;
  items: ReadinessItem[];
}

export const readinessApi = {
  getScore: async (): Promise<ReadinessScore> => {
    const authHeader = await getAuthHeader();
    const res = await fetch(`${API_BASE}/api/readiness-score`, {
      headers: { Authorization: authHeader },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<ReadinessScore>;
  },
};
