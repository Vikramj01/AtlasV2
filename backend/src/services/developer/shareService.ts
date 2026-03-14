/**
 * Developer Share Service
 *
 * Handles share token generation, validation, and progress aggregation
 * for the Developer Portal.
 *
 * Share tokens are 48 hex characters (crypto.randomBytes(24)) — ~10^57
 * possible values, effectively unguessable.
 *
 * Token validation checks: exists, is_active = true, expires_at > now().
 * No JWT required — the token itself is the credential.
 */

import crypto from 'crypto';
import {
  createShare,
  getShareByToken,
  getSharesBySession,
  deactivateShare,
  getProgressByShare,
  upsertPageProgress,
} from '@/services/database/developerQueries';

export interface ShareTokenResult {
  share_id: string;
  share_token: string;
  share_url: string;
  expires_at: string;
}

export interface ValidatedShare {
  share_id: string;
  session_id: string;
  user_id: string;
}

// ── Token generation ──────────────────────────────────────────────────────────

export async function generateShareToken(
  sessionId: string,
  userId: string,
  frontendUrl: string,
): Promise<ShareTokenResult> {
  const token = crypto.randomBytes(24).toString('hex'); // 48 hex chars
  const share = await createShare(sessionId, userId, token);

  return {
    share_id: share.id,
    share_token: token,
    share_url: `${frontendUrl}/dev/${token}`,
    expires_at: share.expires_at,
  };
}

// ── Token validation ──────────────────────────────────────────────────────────

export async function validateShareToken(token: string): Promise<ValidatedShare | null> {
  const share = await getShareByToken(token);
  if (!share) return null;
  if (!share.is_active) return null;
  if (new Date(share.expires_at) < new Date()) return null;

  return {
    share_id: share.id,
    session_id: share.session_id,
    user_id: share.user_id,
  };
}

// ── List shares ───────────────────────────────────────────────────────────────

export async function listSharesForSession(sessionId: string, userId: string) {
  return getSharesBySession(sessionId, userId);
}

// ── Revoke share ──────────────────────────────────────────────────────────────

export async function revokeShare(shareId: string, userId: string): Promise<boolean> {
  return deactivateShare(shareId, userId);
}

// ── Progress aggregation ──────────────────────────────────────────────────────

export interface AggregatedProgress {
  total_pages: number;
  not_started: number;
  in_progress: number;
  implemented: number;
  verified: number;
  percent_complete: number;
  all_implemented: boolean;
  pages: Array<{
    page_id: string;
    page_label: string;
    page_url: string;
    status: string;
    developer_notes: string | null;
    updated_at: string;
  }>;
}

export async function aggregateProgress(shareId: string): Promise<AggregatedProgress> {
  const rows = await getProgressByShare(shareId);

  const counts = { not_started: 0, in_progress: 0, implemented: 0, verified: 0 };
  for (const row of rows) {
    const s = row.status as keyof typeof counts;
    if (s in counts) counts[s]++;
  }

  const total = rows.length;
  const done = counts.implemented + counts.verified;

  return {
    total_pages: total,
    ...counts,
    percent_complete: total > 0 ? Math.round((done / total) * 100) : 0,
    all_implemented: total > 0 && done === total,
    pages: rows.map((r) => ({
      page_id: r.page_id,
      page_label: r.page_label,
      page_url: r.page_url,
      status: r.status,
      developer_notes: r.developer_notes,
      updated_at: r.updated_at,
    })),
  };
}

// ── Update page status ────────────────────────────────────────────────────────

export async function updatePageStatus(
  shareId: string,
  pageId: string,
  status: string,
  developerNotes?: string,
): Promise<void> {
  const validStatuses = ['not_started', 'in_progress', 'implemented', 'verified'];
  if (!validStatuses.includes(status)) {
    throw new Error(`Invalid status: ${status}. Must be one of: ${validStatuses.join(', ')}`);
  }
  await upsertPageProgress(shareId, pageId, status, developerNotes ?? null);
}
