/**
 * Developer Portal Database Queries
 *
 * CRUD for:
 *   - developer_shares  (share tokens, linked to planning_sessions)
 *   - implementation_progress (per-page status, linked to developer_shares)
 *
 * All queries use supabaseAdmin (service role) because developer portal
 * routes are unauthenticated — there's no user JWT context.
 *
 * Ownership checks are performed at the application layer via user_id.
 */

import { supabaseAdmin } from '@/services/database/supabase';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DeveloperShare {
  id: string;
  session_id: string;
  user_id: string;
  share_token: string;
  developer_name: string | null;
  developer_email: string | null;
  is_active: boolean;
  expires_at: string;
  created_at: string;
  invite_sent_at: string | null;
  marketer_notified_at: string | null;
}

export interface ImplementationProgressRow {
  id: string;
  share_id: string;
  page_id: string;
  page_label: string;
  page_url: string;
  status: string;
  developer_notes: string | null;
  updated_at: string;
}

// ── developer_shares CRUD ─────────────────────────────────────────────────────

export async function createShare(
  sessionId: string,
  userId: string,
  token: string,
  developerEmail?: string | null,
  developerName?: string | null,
): Promise<DeveloperShare> {
  const { data, error } = await supabaseAdmin
    .from('developer_shares')
    .insert({
      session_id: sessionId,
      user_id: userId,
      share_token: token,
      developer_email: developerEmail ?? null,
      developer_name: developerName ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(`createShare failed: ${error.message}`);
  return data as DeveloperShare;
}

export async function getShareByToken(token: string): Promise<DeveloperShare | null> {
  const { data, error } = await supabaseAdmin
    .from('developer_shares')
    .select('*')
    .eq('share_token', token)
    .single();

  if (error) return null;
  return data as DeveloperShare;
}

export async function getSharesBySession(
  sessionId: string,
  userId: string,
): Promise<DeveloperShare[]> {
  const { data, error } = await supabaseAdmin
    .from('developer_shares')
    .select('*')
    .eq('session_id', sessionId)
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`getSharesBySession failed: ${error.message}`);
  return (data ?? []) as DeveloperShare[];
}

export async function deactivateShare(shareId: string, userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('developer_shares')
    .update({ is_active: false })
    .eq('id', shareId)
    .eq('user_id', userId)
    .select('id')
    .single();

  if (error) return false;
  return !!data;
}

// ── implementation_progress CRUD ──────────────────────────────────────────────

export async function upsertPageProgress(
  shareId: string,
  pageId: string,
  status: string,
  developerNotes: string | null,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('implementation_progress')
    .upsert(
      {
        share_id: shareId,
        page_id: pageId,
        status,
        developer_notes: developerNotes,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'share_id,page_id' },
    );

  if (error) throw new Error(`upsertPageProgress failed: ${error.message}`);
}

export async function getProgressByShare(shareId: string): Promise<ImplementationProgressRow[]> {
  // Join implementation_progress with planning_pages for labels + URLs
  const { data, error } = await supabaseAdmin
    .from('implementation_progress')
    .select(`
      id,
      share_id,
      page_id,
      status,
      developer_notes,
      updated_at,
      planning_pages!inner (
        url,
        page_title,
        page_order
      )
    `)
    .eq('share_id', shareId)
    .order('planning_pages(page_order)', { ascending: true });

  if (error) throw new Error(`getProgressByShare failed: ${error.message}`);

  type RawRow = {
    id: string;
    share_id: string;
    page_id: string;
    status: string;
    developer_notes: string | null;
    updated_at: string;
    planning_pages: unknown;
  };

  return ((data ?? []) as unknown as RawRow[]).map((row) => {
    const page = row.planning_pages as { url: string; page_title: string | null; page_order: number };
    return {
      id: row.id,
      share_id: row.share_id,
      page_id: row.page_id,
      page_label: page.page_title ?? page.url,
      page_url: page.url,
      status: row.status,
      developer_notes: row.developer_notes,
      updated_at: row.updated_at,
    };
  });
}

// ── Email notification tracking ───────────────────────────────────────────────

/** Mark that the developer invite email has been sent for this share. */
export async function setInviteSent(shareId: string): Promise<void> {
  await supabaseAdmin
    .from('developer_shares')
    .update({ invite_sent_at: new Date().toISOString() })
    .eq('id', shareId);
}

/** Mark that the marketer completion notification has been sent.
 *  Returns false if already notified (idempotency guard). */
export async function markNotified(shareId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('developer_shares')
    .select('marketer_notified_at')
    .eq('id', shareId)
    .single();

  if (!data) return false;
  if (data.marketer_notified_at) return false; // already sent

  const { error } = await supabaseAdmin
    .from('developer_shares')
    .update({ marketer_notified_at: new Date().toISOString() })
    .eq('id', shareId);

  return !error;
}

/** Fetch a share by its ID (used to read developer_email, developer_name, user_id). */
export async function getShareById(shareId: string): Promise<DeveloperShare | null> {
  const { data, error } = await supabaseAdmin
    .from('developer_shares')
    .select('*')
    .eq('id', shareId)
    .single();

  if (error) return null;
  return data as DeveloperShare;
}

// ── Initialise progress rows for all pages in a session ──────────────────────
// Called when a share is first created so every page starts as 'not_started'.

export async function initProgressForShare(
  shareId: string,
  pageIds: string[],
): Promise<void> {
  if (pageIds.length === 0) return;

  const rows = pageIds.map((pageId) => ({
    share_id: shareId,
    page_id: pageId,
    status: 'not_started',
    developer_notes: null,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabaseAdmin
    .from('implementation_progress')
    .upsert(rows, { onConflict: 'share_id,page_id', ignoreDuplicates: true });

  if (error) throw new Error(`initProgressForShare failed: ${error.message}`);
}
