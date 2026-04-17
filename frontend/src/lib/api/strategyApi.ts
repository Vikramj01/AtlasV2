import { supabase } from '@/lib/supabase';
import type { StrategyBrief } from '@/types/strategy';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

async function getAuthHeader(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  return `Bearer ${session.access_token}`;
}

export interface StrategyEvalInput {
  businessType: string;
  outcomeDescription: string;
  outcomeTimingDays: number;
  currentEventName: string;
  eventSource: string;
  valueDataPresent: boolean;
}

export async function evaluateStrategy(input: StrategyEvalInput): Promise<StrategyBrief> {
  const authHeader = await getAuthHeader();
  const res = await fetch(`${API_BASE}/api/strategy/evaluate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader,
    },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }

  const body = (await res.json()) as { data: StrategyBrief };
  return body.data;
}
