/**
 * UploadHistory — sortable, paginated table of past CSV uploads.
 *
 * Loads history on mount. Supports:
 *   - Sort by date (default: newest first)
 *   - Click-through to view upload detail (inline expand)
 *   - Re-upload action (clears active upload → back to UploadArea)
 */

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { offlineConversionsApi } from '@/lib/api/offlineConversionsApi';
import { useOfflineConversionsStore } from '@/store/offlineConversionsStore';
import type { OfflineConversionUpload } from '@/types/offline-conversions';

const PAGE_SIZE = 10;

interface Props {
  /** Called when the user clicks "Upload CSV" — go back to upload flow. */
  onStartUpload: () => void;
}

export function UploadHistory({ onStartUpload }: Props) {
  const { history, historyLoading, historyError, setHistory, setHistoryLoading, setHistoryError } =
    useOfflineConversionsStore();

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  // ── Fetch history ─────────────────────────────────────────────────────────

  useEffect(() => {
    setHistoryLoading(true);
    setHistoryError(null);
    offlineConversionsApi
      .getHistory(1, 100) // load first 100; paginate client-side
      .then(setHistory)
      .catch((err: Error) => setHistoryError(err.message))
      .finally(() => setHistoryLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived state ─────────────────────────────────────────────────────────

  const uploads = history?.uploads ?? [];
  const totalPages = Math.ceil(uploads.length / PAGE_SIZE);
  const pageSlice = uploads.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // ── Loading / Error states ────────────────────────────────────────────────

  if (historyLoading) {
    return (
      <div className="space-y-3 mt-2">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg border bg-muted" />
        ))}
      </div>
    );
  }

  if (historyError) {
    return (
      <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
        Failed to load upload history: {historyError}
      </div>
    );
  }

  // ── Empty state ───────────────────────────────────────────────────────────

  if (uploads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
        <div className="text-3xl">📂</div>
        <div className="space-y-1">
          <p className="text-sm font-medium">No uploads yet</p>
          <p className="text-xs text-muted-foreground">Upload your first CSV to get started.</p>
        </div>
        <Button onClick={onStartUpload}>Upload CSV</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Table */}
      <div className="rounded-md border overflow-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">File</th>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground w-24">Date</th>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground w-24">Status</th>
              <th className="px-3 py-2.5 text-right font-medium text-muted-foreground w-20">Rows</th>
              <th className="px-3 py-2.5 text-right font-medium text-muted-foreground w-20">Uploaded</th>
              <th className="px-3 py-2.5 w-8" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {pageSlice.map((u) => (
              <>
                <tr
                  key={u.id}
                  className="hover:bg-muted/20 cursor-pointer"
                  onClick={() => setExpandedId(expandedId === u.id ? null : u.id)}
                >
                  <td className="px-3 py-2.5 font-medium max-w-[160px] truncate" title={u.filename}>
                    {u.filename}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                    {new Date(u.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2.5">
                    <UploadStatusBadge status={u.status} />
                  </td>
                  <td className="px-3 py-2.5 text-right text-muted-foreground">
                    {u.row_count_total.toLocaleString()}
                  </td>
                  <td className="px-3 py-2.5 text-right text-muted-foreground">
                    {u.row_count_uploaded > 0 ? u.row_count_uploaded.toLocaleString() : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-center text-muted-foreground">
                    {expandedId === u.id ? '▾' : '▸'}
                  </td>
                </tr>

                {/* Expandable detail row */}
                {expandedId === u.id && (
                  <tr key={`${u.id}-detail`}>
                    <td colSpan={6} className="bg-muted/10 px-4 py-3">
                      <UploadDetailExpanded upload={u} />
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, uploads.length)} of{' '}
            {uploads.length}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              className="px-2 py-1 rounded border disabled:opacity-40 hover:bg-muted"
            >
              ← Prev
            </button>
            <button
              type="button"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
              className="px-2 py-1 rounded border disabled:opacity-40 hover:bg-muted"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function UploadDetailExpanded({ upload }: { upload: OfflineConversionUpload }) {
  const rows = [
    { label: 'Total rows', value: upload.row_count_total.toLocaleString() },
    { label: 'Valid', value: upload.row_count_valid.toLocaleString() },
    { label: 'Uploaded to Google', value: upload.row_count_uploaded.toLocaleString() },
    { label: 'Rejected by Google', value: upload.row_count_rejected.toLocaleString() },
    { label: 'Invalid (skipped)', value: upload.row_count_invalid.toLocaleString() },
    { label: 'Duplicate (skipped)', value: upload.row_count_duplicate.toLocaleString() },
  ];

  return (
    <div className="space-y-3">
      {/* Counts grid */}
      <dl className="grid grid-cols-3 gap-x-6 gap-y-1 text-xs">
        {rows.map(({ label, value }) => (
          <div key={label} className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>

      {/* Error message */}
      {upload.error_message && (
        <p className="text-xs text-red-700 border border-red-200 bg-red-50 rounded px-2 py-1">
          {upload.error_message}
        </p>
      )}

      {/* Timestamps */}
      <p className="text-xs text-muted-foreground">
        Uploaded {new Date(upload.created_at).toLocaleString()}
        {upload.completed_at && <> · Completed {new Date(upload.completed_at).toLocaleString()}</>}
      </p>
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  pending:    'bg-gray-100 text-gray-600',
  validating: 'bg-blue-100 text-blue-700',
  validated:  'bg-blue-100 text-blue-700',
  confirmed:  'bg-blue-100 text-blue-700',
  uploading:  'bg-blue-100 text-blue-700',
  completed:  'bg-green-100 text-green-700',
  partial:    'bg-amber-100 text-amber-700',
  failed:     'bg-red-100 text-red-700',
  cancelled:  'bg-gray-100 text-gray-500',
};

function UploadStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium capitalize ${STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-600'}`}
    >
      {status}
    </span>
  );
}
