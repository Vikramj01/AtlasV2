/**
 * ScheduleList — displays and manages the user's scheduled audits.
 *
 * Each row shows: name, URL, frequency, next run, last score, active toggle.
 * Actions: Run Now, Edit (toggle active / change frequency), Delete.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Clock, Play, Trash2, ToggleLeft, ToggleRight,
  AlertTriangle, CheckCircle2, ChevronRight,
} from 'lucide-react';
import { scheduleApi } from '@/lib/api/scheduleApi';
import type { Schedule } from '@/types/schedule';

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function friendlyFrequency(s: Schedule): string {
  if (s.frequency === 'daily') return `Daily at ${String(s.hour_utc).padStart(2, '0')}:00 UTC`;
  const day = s.day_of_week != null ? DAY_SHORT[s.day_of_week] : 'Mon';
  return `Every ${day} at ${String(s.hour_utc).padStart(2, '0')}:00 UTC`;
}

function friendlyNextRun(nextRunAt: string | null): string {
  if (!nextRunAt) return '—';
  const d = new Date(nextRunAt);
  const diffMs = d.getTime() - Date.now();
  if (diffMs < 0) return 'Overdue';
  const h = Math.floor(diffMs / 3600000);
  if (h < 1) return 'In < 1 hour';
  if (h < 24) return `In ${h}h`;
  const days = Math.floor(h / 24);
  return `In ${days}d ${h % 24}h`;
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-xs text-muted-foreground">—</span>;
  const color = score >= 80 ? 'text-green-600' : score >= 60 ? 'text-amber-600' : 'text-red-600';
  return <span className={`text-xs font-semibold tabular-nums ${color}`}>{score}</span>;
}

interface ScheduleListProps {
  schedules: Schedule[];
  onRefresh: () => void;
}

export function ScheduleList({ schedules, onRefresh }: ScheduleListProps) {
  const navigate = useNavigate();
  const [runningId, setRunningId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  if (schedules.length === 0) {
    return (
      <div className="rounded-xl border border-dashed px-6 py-10 text-center">
        <Clock className="h-8 w-8 mx-auto text-muted-foreground/40 mb-3" />
        <p className="text-sm font-medium text-muted-foreground">No scheduled audits yet</p>
        <p className="text-xs text-muted-foreground mt-1">
          Create one to automatically monitor your tracking health on a schedule.
        </p>
      </div>
    );
  }

  async function handleRunNow(s: Schedule) {
    setRunningId(s.id);
    try {
      const { audit_id } = await scheduleApi.runNow(s.id);
      onRefresh();
      navigate(`/audit/${audit_id}/progress`);
    } catch (err) {
      console.error('Failed to run schedule:', err);
    } finally {
      setRunningId(null);
    }
  }

  async function handleToggle(s: Schedule) {
    setTogglingId(s.id);
    try {
      await scheduleApi.update(s.id, { is_active: !s.is_active });
      onRefresh();
    } finally {
      setTogglingId(null);
    }
  }

  async function handleDelete(s: Schedule) {
    if (deletingId === s.id) {
      // Second click = confirm
      try {
        await scheduleApi.delete(s.id);
        onRefresh();
      } catch (err) {
        console.error('Failed to delete schedule:', err);
      } finally {
        setDeletingId(null);
      }
    } else {
      setDeletingId(s.id);
    }
  }

  return (
    <div className="space-y-3">
      {schedules.map((s) => (
        <div
          key={s.id}
          className={`rounded-xl border px-4 py-4 transition-colors ${
            s.is_active ? 'bg-card' : 'bg-muted/30 opacity-70'
          }`}
        >
          <div className="flex items-start gap-3">
            {/* Status icon */}
            <div className="mt-0.5 shrink-0">
              {s.is_active ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : (
                <Clock className="h-4 w-4 text-muted-foreground/40" />
              )}
            </div>

            {/* Main content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold truncate">{s.name}</span>
                {!s.is_active && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
                    Paused
                  </span>
                )}
              </div>
              <a
                href={s.website_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground hover:text-foreground truncate block max-w-xs"
              >
                {s.website_url}
              </a>

              {/* Meta row */}
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {friendlyFrequency(s)}
                </span>
                <span>Next: <strong className="text-foreground">{friendlyNextRun(s.next_run_at)}</strong></span>
                {s.last_run_at && (
                  <span>Last run: {new Date(s.last_run_at).toLocaleDateString()}</span>
                )}
                <span className="flex items-center gap-1">
                  Last score: <ScoreBadge score={s.last_audit_score} />
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 shrink-0">
              {/* Last audit link */}
              {s.last_audit_id && (
                <button
                  type="button"
                  title="View last audit report"
                  onClick={() => navigate(`/report/${s.last_audit_id}`)}
                  className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              )}

              {/* Run Now */}
              <button
                type="button"
                title="Run now"
                disabled={runningId === s.id}
                onClick={() => handleRunNow(s)}
                className="rounded-md p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/5 transition-colors disabled:opacity-40"
              >
                <Play className="h-4 w-4" />
              </button>

              {/* Toggle active */}
              <button
                type="button"
                title={s.is_active ? 'Pause schedule' : 'Resume schedule'}
                disabled={togglingId === s.id}
                onClick={() => handleToggle(s)}
                className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
              >
                {s.is_active
                  ? <ToggleRight className="h-4 w-4 text-green-500" />
                  : <ToggleLeft className="h-4 w-4" />}
              </button>

              {/* Delete */}
              <button
                type="button"
                title={deletingId === s.id ? 'Click again to confirm' : 'Delete schedule'}
                onClick={() => handleDelete(s)}
                className={`rounded-md p-1.5 transition-colors ${
                  deletingId === s.id
                    ? 'text-destructive bg-destructive/10 hover:bg-destructive/20'
                    : 'text-muted-foreground hover:text-destructive hover:bg-destructive/5'
                }`}
              >
                {deletingId === s.id
                  ? <AlertTriangle className="h-4 w-4" />
                  : <Trash2 className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
