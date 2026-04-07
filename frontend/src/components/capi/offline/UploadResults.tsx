/**
 * UploadResults — final outcome after Google Ads upload completes.
 *
 * Statuses handled:
 *   - 'completed'  → all valid rows accepted by Google
 *   - 'partial'    → some rows rejected by Google (partial_failure mode)
 *   - 'failed'     → upload failed entirely (API error / token issue)
 *
 * Shows:
 *   - Outcome banner (success / partial / error)
 *   - Row counts (uploaded / rejected / invalid / duplicate)
 *   - Rejected rows table (from upload_result.row_results) — paginated client-side
 *   - Actions: Upload another / View history
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { OfflineConversionUpload } from '@/types/offline-conversions';

const PAGE_SIZE = 20;

interface Props {
  upload: OfflineConversionUpload;
  onUploadAnother: () => void;
  onViewHistory: () => void;
}

export function UploadResults({ upload, onUploadAnother, onViewHistory }: Props) {
  const [rejectedPage, setRejectedPage] = useState(0);

  const rejected = (upload.upload_result?.row_results ?? []).filter(
    (r) => r.status === 'rejected',
  );
  const totalRejectedPages = Math.ceil(rejected.length / PAGE_SIZE);
  const rejectedSlice = rejected.slice(rejectedPage * PAGE_SIZE, (rejectedPage + 1) * PAGE_SIZE);

  // ── Outcome banner ────────────────────────────────────────────────────────

  const outcome = upload.status;

  const bannerProps = {
    completed: {
      cls: 'border-green-300 bg-green-50 text-green-800',
      icon: '✓',
      title: 'Upload complete',
      body: `${upload.row_count_uploaded.toLocaleString()} conversion${upload.row_count_uploaded !== 1 ? 's' : ''} sent to Google Ads successfully.`,
    },
    partial: {
      cls: 'border-amber-300 bg-amber-50 text-amber-800',
      icon: '⚠',
      title: 'Upload partially accepted',
      body: `${upload.row_count_uploaded.toLocaleString()} row${upload.row_count_uploaded !== 1 ? 's' : ''} accepted. ${upload.row_count_rejected.toLocaleString()} rejected by Google — see details below.`,
    },
    failed: {
      cls: 'border-red-300 bg-red-50 text-red-800',
      icon: '✕',
      title: 'Upload failed',
      body: upload.error_message ?? 'An unexpected error occurred while sending to Google Ads.',
    },
  }[outcome as 'completed' | 'partial' | 'failed'] ?? {
    cls: 'border-gray-300 bg-gray-50 text-gray-800',
    icon: '•',
    title: 'Upload finished',
    body: '',
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Upload results</h3>
          <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-xs">{upload.filename}</p>
        </div>
        <StatusChip status={upload.status} />
      </div>

      {/* Outcome banner */}
      <div className={`rounded-md border px-4 py-3 text-sm flex items-start gap-2 ${bannerProps.cls}`}>
        <span className="font-bold mt-0.5">{bannerProps.icon}</span>
        <div>
          <p className="font-semibold">{bannerProps.title}</p>
          <p className="text-xs mt-0.5">{bannerProps.body}</p>
        </div>
      </div>

      {/* Row count summary */}
      <div className="grid grid-cols-4 gap-3">
        <StatChip
          value={upload.row_count_uploaded.toLocaleString()}
          label="Uploaded"
          color="green"
        />
        <StatChip
          value={upload.row_count_rejected.toLocaleString()}
          label="Rejected"
          color={upload.row_count_rejected > 0 ? 'red' : 'gray'}
        />
        <StatChip
          value={upload.row_count_invalid.toLocaleString()}
          label="Invalid"
          color={upload.row_count_invalid > 0 ? 'amber' : 'gray'}
        />
        <StatChip
          value={upload.row_count_duplicate.toLocaleString()}
          label="Duplicate"
          color={upload.row_count_duplicate > 0 ? 'amber' : 'gray'}
        />
      </div>

      {/* Rejected rows from Google */}
      {rejected.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Rows rejected by Google ({rejected.length.toLocaleString()})
          </p>
          <div className="rounded-md border overflow-auto max-h-64">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground w-16">Row</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground w-32">Code</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Message</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rejectedSlice.map((r) => (
                  <tr key={r.row_index} className="hover:bg-muted/20">
                    <td className="px-3 py-2 text-muted-foreground">{r.row_index + 1}</td>
                    <td className="px-3 py-2 font-mono text-red-700">{r.error_code ?? '—'}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.error_message ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Rejected row pagination */}
          {totalRejectedPages > 1 && (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Page {rejectedPage + 1} of {totalRejectedPages}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={rejectedPage === 0}
                  onClick={() => setRejectedPage((p) => p - 1)}
                  className="px-2 py-1 rounded border disabled:opacity-40 hover:bg-muted"
                >
                  ← Prev
                </button>
                <button
                  type="button"
                  disabled={rejectedPage >= totalRejectedPages - 1}
                  onClick={() => setRejectedPage((p) => p + 1)}
                  className="px-2 py-1 rounded border disabled:opacity-40 hover:bg-muted"
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Timing metadata */}
      {upload.completed_at && (
        <p className="text-xs text-muted-foreground">
          Completed {new Date(upload.completed_at).toLocaleString()}
          {upload.processing_started_at && (
            <>
              {' · '}
              {formatDuration(
                new Date(upload.processing_started_at),
                new Date(upload.completed_at),
              )}{' '}
              processing time
            </>
          )}
        </p>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-2 border-t">
        <Button variant="ghost" size="sm" onClick={onViewHistory}>
          View history
        </Button>
        <Button onClick={onUploadAnother}>Upload another CSV</Button>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(start: Date, end: Date): string {
  const secs = Math.round((end.getTime() - start.getTime()) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
}

const CHIP_COLORS = {
  gray:  'bg-gray-100 text-gray-700',
  green: 'bg-green-100 text-green-700',
  red:   'bg-red-100 text-red-700',
  amber: 'bg-amber-100 text-amber-700',
} as const;

function StatChip({ value, label, color }: { value: string; label: string; color: keyof typeof CHIP_COLORS }) {
  return (
    <div className={`rounded-lg px-3 py-3 text-center space-y-0.5 ${CHIP_COLORS[color]}`}>
      <p className="text-lg font-bold leading-none">{value}</p>
      <p className="text-xs opacity-80">{label}</p>
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  completed: 'bg-green-100 text-green-700',
  partial:   'bg-amber-100 text-amber-700',
  failed:    'bg-red-100 text-red-700',
};

function StatusChip({ status }: { status: string }) {
  return (
    <span className={`shrink-0 text-xs px-2 py-0.5 rounded font-medium capitalize ${STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  );
}
