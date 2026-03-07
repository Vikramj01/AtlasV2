/**
 * Planning Mode — Database CRUD layer.
 * All Planning Mode DB access goes through these functions.
 * No raw SQL in route handlers.
 *
 * Follows the same pattern as journeyQueries.ts.
 */
import { supabaseAdmin as supabase, getScreenshotSignedUrl } from './supabase';
import type {
  PlanningSession,
  PlanningPage,
  PlanningRecommendation,
  PlanningOutput,
  SessionStatus,
  PageStatus,
  UserDecision,
  OutputType,
  CreateSessionInput,
  SuggestedParam,
} from '@/types/planning';

// ── Sessions ─────────────────────────────────────────────────────────────────

export async function createSession(userId: string, input: CreateSessionInput): Promise<PlanningSession> {
  const { data, error } = await supabase
    .from('planning_sessions')
    .insert({
      user_id: userId,
      website_url: input.website_url,
      business_type: input.business_type,
      business_description: input.business_description ?? null,
      selected_platforms: input.selected_platforms,
      status: 'setup',
    })
    .select('*')
    .single();

  if (error) throw new Error(`Failed to create planning session: ${error.message}`);
  return data as PlanningSession;
}

export async function getSession(sessionId: string, userId: string): Promise<PlanningSession | null> {
  const { data, error } = await supabase
    .from('planning_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .single();

  if (error?.code === 'PGRST116') return null;
  if (error) throw new Error(`Failed to get session: ${error.message}`);
  return data as PlanningSession;
}

export async function listSessions(userId: string): Promise<PlanningSession[]> {
  const { data, error } = await supabase
    .from('planning_sessions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to list sessions: ${error.message}`);
  return (data ?? []) as PlanningSession[];
}

export async function updateSessionStatus(
  sessionId: string,
  status: SessionStatus,
  errorMessage?: string,
): Promise<void> {
  const update: Record<string, unknown> = { status };
  if (errorMessage !== undefined) update['error_message'] = errorMessage;
  if (status === 'outputs_ready' || status === 'review_ready') {
    update['completed_at'] = status === 'outputs_ready' ? new Date().toISOString() : null;
  }

  const { error } = await supabase
    .from('planning_sessions')
    .update(update)
    .eq('id', sessionId);

  if (error) throw new Error(`Failed to update session status: ${error.message}`);
}

/** Count planning sessions created this calendar month for a user (used by rate limiter). */
export async function countPlanningSessionsThisMonth(userId: string): Promise<number> {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { count, error } = await supabase
    .from('planning_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', startOfMonth.toISOString());

  if (error) throw new Error(`Failed to count sessions: ${error.message}`);
  return count ?? 0;
}

// ── Pages ─────────────────────────────────────────────────────────────────────

export async function createPage(
  sessionId: string,
  url: string,
  pageType: string,
  pageOrder: number,
): Promise<PlanningPage> {
  const { data, error } = await supabase
    .from('planning_pages')
    .insert({ session_id: sessionId, url, page_type: pageType, page_order: pageOrder, status: 'pending' })
    .select('*')
    .single();

  if (error) throw new Error(`Failed to create planning page: ${error.message}`);
  return data as PlanningPage;
}

export async function getPagesBySession(sessionId: string): Promise<PlanningPage[]> {
  const { data, error } = await supabase
    .from('planning_pages')
    .select('*')
    .eq('session_id', sessionId)
    .order('page_order', { ascending: true });

  if (error) throw new Error(`Failed to get pages: ${error.message}`);
  return (data ?? []) as PlanningPage[];
}

export async function updatePage(
  pageId: string,
  updates: {
    status?: PageStatus;
    page_title?: string;
    meta_description?: string;
    screenshot_url?: string;
    existing_tracking?: Array<{ platform: string; detected_via: string; detail: string }>;
    error_message?: string;
    scanned_at?: string;
  },
): Promise<void> {
  const { error } = await supabase
    .from('planning_pages')
    .update(updates)
    .eq('id', pageId);

  if (error) throw new Error(`Failed to update page: ${error.message}`);
}

/** Convenience: get page with a fresh signed URL for its screenshot. */
export async function getPageWithSignedUrl(pageId: string): Promise<PlanningPage & { screenshot_signed_url?: string }> {
  const { data, error } = await supabase
    .from('planning_pages')
    .select('*')
    .eq('id', pageId)
    .single();

  if (error?.code === 'PGRST116') throw new Error('Page not found');
  if (error) throw new Error(`Failed to get page: ${error.message}`);

  const page = data as PlanningPage;
  let screenshot_signed_url: string | undefined;

  if (page.screenshot_url) {
    screenshot_signed_url = await getScreenshotSignedUrl(page.screenshot_url).catch(() => undefined);
  }

  return { ...page, screenshot_signed_url };
}

// ── Recommendations ───────────────────────────────────────────────────────────

export interface CreateRecommendationInput {
  page_id: string;
  element_selector?: string;
  element_text?: string;
  element_type?: string;
  action_type: string;
  event_name: string;
  required_params: SuggestedParam[];
  optional_params?: SuggestedParam[];
  bbox_x?: number;
  bbox_y?: number;
  bbox_width?: number;
  bbox_height?: number;
  confidence_score: number;
  business_justification: string;
  affected_platforms: string[];
  source?: 'ai' | 'manual';
}

export async function createRecommendations(
  inputs: CreateRecommendationInput[],
): Promise<PlanningRecommendation[]> {
  if (inputs.length === 0) return [];

  const rows = inputs.map((r) => ({
    page_id: r.page_id,
    element_selector: r.element_selector ?? null,
    element_text: r.element_text ?? null,
    element_type: r.element_type ?? null,
    action_type: r.action_type,
    event_name: r.event_name,
    required_params: r.required_params,
    optional_params: r.optional_params ?? [],
    bbox_x: r.bbox_x ?? null,
    bbox_y: r.bbox_y ?? null,
    bbox_width: r.bbox_width ?? null,
    bbox_height: r.bbox_height ?? null,
    confidence_score: r.confidence_score,
    business_justification: r.business_justification,
    affected_platforms: r.affected_platforms,
    source: r.source ?? 'ai',
  }));

  const { data, error } = await supabase
    .from('planning_recommendations')
    .insert(rows)
    .select('*');

  if (error) throw new Error(`Failed to create recommendations: ${error.message}`);
  return (data ?? []) as PlanningRecommendation[];
}

export async function getRecommendationsBySession(sessionId: string): Promise<PlanningRecommendation[]> {
  const { data, error } = await supabase
    .from('planning_recommendations')
    .select('*, planning_pages!inner(session_id)')
    .eq('planning_pages.session_id', sessionId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Failed to get recommendations: ${error.message}`);
  return (data ?? []) as unknown as PlanningRecommendation[];
}

export async function getRecommendationsByPage(pageId: string): Promise<PlanningRecommendation[]> {
  const { data, error } = await supabase
    .from('planning_recommendations')
    .select('*')
    .eq('page_id', pageId)
    .order('confidence_score', { ascending: false });

  if (error) throw new Error(`Failed to get recommendations: ${error.message}`);
  return (data ?? []) as PlanningRecommendation[];
}

export async function getRecommendation(recId: string): Promise<PlanningRecommendation | null> {
  const { data, error } = await supabase
    .from('planning_recommendations')
    .select('*')
    .eq('id', recId)
    .single();

  if (error?.code === 'PGRST116') return null;
  if (error) throw new Error(`Failed to get recommendation: ${error.message}`);
  return data as PlanningRecommendation;
}

export async function updateRecommendationDecision(
  recId: string,
  decision: UserDecision,
  modifiedConfig?: Record<string, unknown>,
): Promise<PlanningRecommendation> {
  const { data, error } = await supabase
    .from('planning_recommendations')
    .update({
      user_decision: decision,
      modified_config: modifiedConfig ?? null,
      decided_at: new Date().toISOString(),
    })
    .eq('id', recId)
    .select('*')
    .single();

  if (error) throw new Error(`Failed to update recommendation decision: ${error.message}`);
  return data as PlanningRecommendation;
}

export async function getApprovedRecommendations(sessionId: string): Promise<PlanningRecommendation[]> {
  const { data, error } = await supabase
    .from('planning_recommendations')
    .select('*, planning_pages!inner(session_id)')
    .eq('planning_pages.session_id', sessionId)
    .in('user_decision', ['approved', 'modified']);

  if (error) throw new Error(`Failed to get approved recommendations: ${error.message}`);
  return (data ?? []) as unknown as PlanningRecommendation[];
}

// ── Outputs ───────────────────────────────────────────────────────────────────

export async function createOutput(
  sessionId: string,
  outputType: OutputType,
  content: unknown,
  contentText: string | null,
  mimeType: string,
  storagePath?: string,
): Promise<PlanningOutput> {
  // Increment version if a previous output of this type exists
  const { data: existing } = await supabase
    .from('planning_outputs')
    .select('version')
    .eq('session_id', sessionId)
    .eq('output_type', outputType)
    .order('version', { ascending: false })
    .limit(1)
    .single();

  const version = (existing?.version ?? 0) + 1;

  const { data, error } = await supabase
    .from('planning_outputs')
    .insert({
      session_id: sessionId,
      output_type: outputType,
      content: content ?? null,
      content_text: contentText,
      storage_path: storagePath ?? null,
      mime_type: mimeType,
      version,
    })
    .select('*')
    .single();

  if (error) throw new Error(`Failed to create output: ${error.message}`);
  return data as PlanningOutput;
}

export async function getOutputs(sessionId: string): Promise<PlanningOutput[]> {
  const { data, error } = await supabase
    .from('planning_outputs')
    .select('*')
    .eq('session_id', sessionId)
    .order('generated_at', { ascending: false });

  if (error) throw new Error(`Failed to get outputs: ${error.message}`);
  return (data ?? []) as PlanningOutput[];
}

export async function getOutput(outputId: string, sessionId: string): Promise<PlanningOutput | null> {
  const { data, error } = await supabase
    .from('planning_outputs')
    .select('*')
    .eq('id', outputId)
    .eq('session_id', sessionId)
    .single();

  if (error?.code === 'PGRST116') return null;
  if (error) throw new Error(`Failed to get output: ${error.message}`);
  return data as PlanningOutput;
}
