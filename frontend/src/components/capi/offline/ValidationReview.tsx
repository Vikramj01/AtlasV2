/**
 * ValidationReview — shows the result of CSV validation and lets the user
 * confirm (hash PII + send to Google) or cancel the upload.
 *
 * Sections:
 *   - Row count summary (total / valid / invalid / duplicate) as stat chips
 *   - Error sample table (up to 20 invalid/duplicate rows from backend)
 *   - Collapsible warnings section
 *   - Confirm / Cancel / Re-upload actions
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { offlineConversionsApi } from '@/lib/api/offlineConversionsApi';
import { useOfflineConversionsStore } from '@/store/offlineConversionsStore';
import type { OfflineConversionUpload, OfflineConversionRow, ValidationSummary } from '@/types/offline-conversions';

interface Props {
  upload: OfflineConversionUpload;
  summary: ValidationSummary;
  errorSample: OfflineConversionRow[];
  onConfirmed: () => void;
  onCancel: () => void;
}

export function ValidationReview({ upload, summary, errorSample, onConfirmed, onCancel }: Props) {
  const { setUploadError } = useOfflineConversionsStore();
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [warningsOpen, setWarningsOpen] = useState(false);

  const hasErrors = summary.invalid_rows > 0 || summary.duplicate_rows > 0;
  const canConfirm = summary.valid_rows > 0;

  // ── Confirm: hash PII + queue for Google upload ───────────────────────────

  async function handleConfirm() {
    setConfirming(true);
    setUploadError(null);
    try {
      await offlineConversionsApi.confirmUpload(upload.id);
      onConfirmed();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to confirm upload');
      setConfirming(false);
    }
  }

  // ── Cancel upload ─────────────────────────────────────────────────────────

  async function handleCancel() {
    setCancelling(true);
    try {
      await offlineConversionsApi.cancelUpload(upload.id);
    } catch {
      // If cancel fails, still clear the local state so the user can re-upload
    } finally {
      onCancel();
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Validation results</h3>
          <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-xs">{upload.filename}</p>
        </div>
        <span className="shrink-0 text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">
          Validated
        </span>
      </div>

      {/* Row count summary */}
      <div className="grid grid-cols-4 gap-3">
        <StatChip
          value={summary.total_rows.toLocaleString()}
          label="Total rows"
          color="gray"
        />
        <StatChip
          value={summary.valid_rows.toLocaleString()}
          label="Valid"
          color="green"
        />
        <StatChip
          value={summary.invalid_rows.toLocaleString()}
          label="Invalid"
          color={summary.invalid_rows > 0 ? 'red' : 'gray'}
        />
        <StatChip
          value={summary.duplicate_rows.toLocaleString()}
          label="Duplicate"
          color={summary.duplicate_rows > 0 ? 'amber' : 'gray'}
        />
      </div>

      {/* All-invalid state */}
      {!canConfirm && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          No valid rows found. Fix the errors below and re-upload a corrected CSV.
        </div>
      )}

      {/* All-duplicate state */}
      {canConfirm && summary.duplicate_rows === summary.total_rows && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          All rows were already uploaded in a previous batch.
        </div>
      )}

      {/* Partial valid — info */}
      {canConfirm && hasErrors && (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          {summary.valid_rows.toLocaleString()} valid row{summary.valid_rows !== 1 ? 's' : ''} will
          be uploaded to Google Ads. Invalid and duplicate rows will be skipped.
        </div>
      )}

      {/* Error sample table */}
      {errorSample.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Error sample (first {errorSample.length} of {summary.invalid_rows + summary.duplicate_rows} problem rows)
          </p>
          <div className="rounded-md border overflow-auto max-h-56">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground w-16">Row</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground w-20">Status</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Issue</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {errorSample.map((row) => {
                  const firstIssue = (row.validation_errors ?? [])[0] ?? (row.validation_warnings ?? [])[0];
                  return (
                    <tr key={row.id} className="hover:bg-muted/20">
                      <td className="px-3 py-2 text-muted-foreground">{row.row_index}</td>
                      <td className="px-3 py-2">
                        <RowStatusBadge status={row.status} />
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {firstIssue
                          ? <><span className="font-medium text-foreground">{firstIssue.field}:</span> {firstIssue.message}</>
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Warnings (collapsible) */}
      {summary.warnings.length > 0 && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setWarningsOpen((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-amber-700 hover:text-amber-900 focus:outline-none"
          >
            <span>{warningsOpen ? '▾' : '▸'}</span>
            {summary.warnings.length} warning{summary.warnings.length !== 1 ? 's' : ''} (non-blocking)
          </button>
          {warningsOpen && (
            <div className="rounded-md border border-amber-200 bg-amber-50 divide-y divide-amber-200 max-h-40 overflow-auto">
              {summary.warnings.map((w, i) => (
                <div key={i} className="px-3 py-2 text-xs text-amber-800">
                  <span className="font-medium">Row {w.row} · {w.field}:</span> {w.message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-2 border-t">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCancel}
          disabled={cancelling || confirming}
        >
          {cancelling ? 'Cancelling…' : 'Cancel'}
        </Button>
        <div className="flex gap-2">
          {!canConfirm && (
            <Button variant="outline" size="sm" onClick={onCancel}>
              Re-upload
            </Button>
          )}
          {canConfirm && (
            <Button onClick={handleConfirm} disabled={confirming}>
              {confirming
                ? 'Sending to Google…'
                : `Upload ${summary.valid_rows.toLocaleString()} conversion${summary.valid_rows !== 1 ? 's' : ''}`}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

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

function RowStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    invalid:   'bg-red-100 text-red-700',
    duplicate: 'bg-amber-100 text-amber-700',
    valid:     'bg-green-100 text-green-700',
  };
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${map[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  );
}
