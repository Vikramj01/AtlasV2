import { supabase } from '@/lib/supabase';
import type { BusinessType, ImplementationFormat, Platform, JourneyWithDetails, Journey, SpecFormat } from '@/types/journey';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  };
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers: { ...headers, ...options?.headers } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Journeys ──────────────────────────────────────────────────────────────────

export interface CreateJourneyPayload {
  name?: string;
  business_type: BusinessType;
  implementation_format?: ImplementationFormat;
  stages?: Array<{
    stage_order: number;
    label: string;
    page_type: string;
    sample_url?: string | null;
    actions: string[];
  }>;
  platforms?: Array<{
    platform: Platform;
    is_active: boolean;
    measurement_id?: string | null;
  }>;
}

export async function createJourney(payload: CreateJourneyPayload): Promise<JourneyWithDetails> {
  return apiFetch('/api/journeys', { method: 'POST', body: JSON.stringify(payload) });
}

export async function listJourneys(): Promise<Journey[]> {
  return apiFetch('/api/journeys');
}

export async function getJourney(journeyId: string): Promise<JourneyWithDetails> {
  return apiFetch(`/api/journeys/${journeyId}`);
}

export async function updateJourney(journeyId: string, data: Partial<{ name: string; business_type: BusinessType; implementation_format: ImplementationFormat }>): Promise<Journey> {
  return apiFetch(`/api/journeys/${journeyId}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function deleteJourney(journeyId: string): Promise<void> {
  await apiFetch(`/api/journeys/${journeyId}`, { method: 'DELETE' });
}

// ── Stages ────────────────────────────────────────────────────────────────────

export async function upsertPlatforms(
  journeyId: string,
  platforms: Array<{ platform: Platform; is_active: boolean; measurement_id?: string | null }>,
): Promise<void> {
  await apiFetch(`/api/journeys/${journeyId}/platforms`, {
    method: 'PUT',
    body: JSON.stringify({ platforms }),
  });
}

// ── Spec Generation ───────────────────────────────────────────────────────────

export async function generateSpecs(
  journeyId: string,
  formats?: SpecFormat[],
): Promise<{ generated: SpecFormat[]; specs: Record<SpecFormat, unknown> }> {
  return apiFetch(`/api/journeys/${journeyId}/generate`, {
    method: 'POST',
    body: JSON.stringify({ formats }),
  });
}

export async function getSpec(journeyId: string, format: SpecFormat): Promise<{ spec_data: unknown; version: number; generated_at: string }> {
  return apiFetch(`/api/journeys/${journeyId}/specs/${format}`);
}

// ── Templates ─────────────────────────────────────────────────────────────────

export interface SavedTemplate {
  id: string;
  name: string;
  description: string | null;
  business_type: BusinessType;
  is_system: boolean;
  template_data: {
    stages: Array<{ order: number; label: string; page_type: string; actions: string[] }>;
  };
  created_at: string;
}

export async function listTemplates(): Promise<SavedTemplate[]> {
  return apiFetch('/api/journeys/templates');
}

export async function saveTemplate(data: {
  name: string;
  description?: string;
  business_type: BusinessType;
  template_data: {
    stages: Array<{ order: number; label: string; page_type: string; actions: string[] }>;
  };
}): Promise<SavedTemplate> {
  return apiFetch('/api/journeys/templates', { method: 'POST', body: JSON.stringify(data) });
}

export async function deleteUserTemplate(templateId: string): Promise<void> {
  await apiFetch(`/api/journeys/templates/${templateId}`, { method: 'DELETE' });
}

export async function createJourneyFromTemplate(
  templateId: string,
  name?: string,
  implementationFormat?: ImplementationFormat,
): Promise<JourneyWithDetails> {
  return apiFetch(`/api/journeys/from-template/${templateId}`, {
    method: 'POST',
    body: JSON.stringify({ name, implementation_format: implementationFormat }),
  });
}
