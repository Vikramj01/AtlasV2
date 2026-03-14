import { supabase } from '@/lib/supabase';
import type {
  CreateSessionInput,
  CreateSessionResponse,
  GetSessionResponse,
  GetRecommendationsResponse,
  UpdateDecisionInput,
  GenerateOutputsResponse,
  ListSessionsResponse,
  HandoffResponse,
  UserDecision,
  PlanningRecommendation,
  PlanningOutput,
  SiteDetection,
} from '@/types/planning';

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
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export const planningApi = {
  // ── Sessions ────────────────────────────────────────────────────────────────

  createSession(input: CreateSessionInput): Promise<CreateSessionResponse> {
    return apiFetch('/api/planning/sessions', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  listSessions(): Promise<ListSessionsResponse> {
    return apiFetch('/api/planning/sessions');
  },

  getSession(sessionId: string): Promise<GetSessionResponse> {
    return apiFetch(`/api/planning/sessions/${sessionId}`);
  },

  // ── Recommendations ─────────────────────────────────────────────────────────

  getRecommendations(sessionId: string): Promise<GetRecommendationsResponse> {
    return apiFetch(`/api/planning/sessions/${sessionId}/recommendations`);
  },

  createRecommendation(
    sessionId: string,
    body: {
      page_id: string;
      action_type: string;
      event_name: string;
      element_selector?: string;
      element_text?: string;
      business_justification?: string;
      affected_platforms?: string[];
    },
  ): Promise<PlanningRecommendation> {
    return apiFetch(`/api/planning/sessions/${sessionId}/recommendations`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  updateDecision(
    sessionId: string,
    recId: string,
    decision: UserDecision,
    modified_config?: Record<string, unknown>,
  ): Promise<{ recommendation_id: string; decision: UserDecision }> {
    const body: UpdateDecisionInput = { user_decision: decision };
    if (modified_config) body.modified_config = modified_config;
    return apiFetch(`/api/planning/sessions/${sessionId}/recommendations/${recId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },

  // ── Outputs ─────────────────────────────────────────────────────────────────

  generateOutputs(sessionId: string): Promise<GenerateOutputsResponse> {
    return apiFetch(`/api/planning/sessions/${sessionId}/generate`, {
      method: 'POST',
    });
  },

  listOutputs(sessionId: string): Promise<{ outputs: PlanningOutput[] }> {
    return apiFetch(`/api/planning/sessions/${sessionId}/outputs`);
  },

  downloadOutput(sessionId: string, outputId: string): Promise<Blob> {
    return getAuthHeader().then((auth) =>
      fetch(`${API_BASE}/api/planning/sessions/${sessionId}/outputs/${outputId}/download`, {
        headers: { Authorization: auth },
      }).then((r) => {
        if (!r.ok) throw new Error(`Download failed: ${r.status}`);
        return r.blob();
      })
    );
  },

  // ── Screenshot ──────────────────────────────────────────────────────────────

  getScreenshotUrl(sessionId: string, pageId: string): Promise<{ url: string }> {
    return apiFetch(`/api/planning/sessions/${sessionId}/pages/${pageId}/screenshot`);
  },

  // ── Handoff ─────────────────────────────────────────────────────────────────

  handoff(sessionId: string): Promise<HandoffResponse> {
    return apiFetch(`/api/planning/sessions/${sessionId}/handoff`, {
      method: 'POST',
    });
  },

  deleteSession(sessionId: string): Promise<{ deleted: boolean }> {
    return apiFetch(`/api/planning/sessions/${sessionId}`, { method: 'DELETE' });
  },

  // ── Site Detection ───────────────────────────────────────────────────────────

  detectSite(url: string): Promise<SiteDetection> {
    return apiFetch('/api/planning/detect', {
      method: 'POST',
      body: JSON.stringify({ url }),
    });
  },
};
