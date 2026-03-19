/**
 * Schedule CRUD queries.
 *
 * All ownership checks use user_id so users can never touch each other's schedules.
 * `getDueSchedules` is called by the schedule runner and has no user_id filter —
 * it selects across all users.
 */

import { supabaseAdmin } from './supabase';
import type { ScheduleRow, CreateScheduleInput, UpdateScheduleInput } from '@/types/schedule';
import type { Region } from '@/types/audit';

// ── next_run_at computation ───────────────────────────────────────────────────

/**
 * Compute the next UTC Date when a schedule should run.
 * - daily:  next occurrence of `hourUtc` (today if not yet passed, else tomorrow)
 * - weekly: next occurrence of `dayOfWeek` at `hourUtc`
 */
export function computeNextRunAt(
  frequency: 'daily' | 'weekly',
  hourUtc: number,
  dayOfWeek: number | null,
  from: Date = new Date(),
): Date {
  const next = new Date(from);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(hourUtc);

  if (frequency === 'daily') {
    // If the target hour has already passed today, move to tomorrow
    if (next <= from) next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }

  // Weekly
  const targetDay = dayOfWeek ?? 1; // default Monday
  const currentDay = next.getUTCDay();
  let daysUntil = (targetDay - currentDay + 7) % 7;
  // If it's the same day but the hour has passed (or it's now), move to next week
  if (daysUntil === 0 && next <= from) daysUntil = 7;
  next.setUTCDate(next.getUTCDate() + daysUntil);
  return next;
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function createSchedule(
  userId: string,
  input: CreateScheduleInput,
): Promise<ScheduleRow> {
  const hourUtc = input.hour_utc ?? 2;
  const dayOfWeek = input.frequency === 'weekly' ? (input.day_of_week ?? 1) : null;
  const nextRunAt = computeNextRunAt(input.frequency, hourUtc, dayOfWeek);

  const { data, error } = await supabaseAdmin
    .from('scheduled_audits')
    .insert({
      user_id: userId,
      name: input.name,
      website_url: input.website_url,
      funnel_type: input.funnel_type,
      region: input.region ?? 'us',
      url_map: input.url_map,
      frequency: input.frequency,
      day_of_week: dayOfWeek,
      hour_utc: hourUtc,
      is_active: true,
      next_run_at: nextRunAt.toISOString(),
      test_email: input.test_email ?? null,
      test_phone: input.test_phone ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create schedule: ${error.message}`);
  return data as ScheduleRow;
}

export async function getSchedule(
  scheduleId: string,
  userId: string,
): Promise<ScheduleRow | null> {
  const { data, error } = await supabaseAdmin
    .from('scheduled_audits')
    .select()
    .eq('id', scheduleId)
    .eq('user_id', userId)
    .single();

  if (error) return null;
  return data as ScheduleRow;
}

export async function listSchedules(userId: string): Promise<ScheduleRow[]> {
  const { data, error } = await supabaseAdmin
    .from('scheduled_audits')
    .select()
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to list schedules: ${error.message}`);
  return (data ?? []) as ScheduleRow[];
}

export async function updateSchedule(
  scheduleId: string,
  userId: string,
  input: UpdateScheduleInput,
): Promise<ScheduleRow> {
  const updates: Record<string, unknown> = { ...input, updated_at: new Date().toISOString() };

  // Recompute next_run_at if frequency or timing changed
  if (input.frequency !== undefined || input.hour_utc !== undefined || input.day_of_week !== undefined) {
    const existing = await getSchedule(scheduleId, userId);
    if (!existing) throw new Error('Schedule not found');
    const frequency = input.frequency ?? existing.frequency;
    const hourUtc = input.hour_utc ?? existing.hour_utc;
    const dayOfWeek =
      input.day_of_week !== undefined ? input.day_of_week : existing.day_of_week;
    updates.next_run_at = computeNextRunAt(frequency, hourUtc, dayOfWeek).toISOString();
    if (frequency === 'daily') updates.day_of_week = null;
  }

  const { data, error } = await supabaseAdmin
    .from('scheduled_audits')
    .update(updates)
    .eq('id', scheduleId)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update schedule: ${error.message}`);
  return data as ScheduleRow;
}

export async function deleteSchedule(scheduleId: string, userId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('scheduled_audits')
    .delete()
    .eq('id', scheduleId)
    .eq('user_id', userId);

  if (error) throw new Error(`Failed to delete schedule: ${error.message}`);
}

/** Called by the schedule runner — no user filter (runs for all users). */
export async function getDueSchedules(): Promise<ScheduleRow[]> {
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('scheduled_audits')
    .select()
    .eq('is_active', true)
    .lte('next_run_at', now);

  if (error) throw new Error(`Failed to get due schedules: ${error.message}`);
  return (data ?? []) as ScheduleRow[];
}

/** Mark a schedule as having just run: update last_run_at, last_audit_id, next_run_at. */
export async function markScheduleRan(
  scheduleId: string,
  auditId: string,
  frequency: 'daily' | 'weekly',
  hourUtc: number,
  dayOfWeek: number | null,
): Promise<void> {
  const nextRunAt = computeNextRunAt(frequency, hourUtc, dayOfWeek);
  const { error } = await supabaseAdmin
    .from('scheduled_audits')
    .update({
      last_run_at: new Date().toISOString(),
      last_audit_id: auditId,
      next_run_at: nextRunAt.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', scheduleId);

  if (error) throw new Error(`Failed to mark schedule ran: ${error.message}`);
}

/** Update last_audit_score after a scheduled audit completes. */
export async function updateScheduleScore(
  scheduleId: string,
  score: number,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('scheduled_audits')
    .update({ last_audit_score: score, updated_at: new Date().toISOString() })
    .eq('id', scheduleId);

  if (error) throw new Error(`Failed to update schedule score: ${error.message}`);
}

/** Fetch schedule by last_audit_id (used after audit completes to find owning schedule). */
export async function getScheduleByAuditId(
  auditId: string,
): Promise<ScheduleRow | null> {
  const { data, error } = await supabaseAdmin
    .from('scheduled_audits')
    .select()
    .eq('last_audit_id', auditId)
    .maybeSingle();

  if (error) return null;
  return data as ScheduleRow | null;
}

// Re-export Region so callers don't need to import from two places
export type { Region };
