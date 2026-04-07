/**
 * UploadProgress — polls upload status every 3 seconds while processing.
 *
 * Shown when upload is in 'confirmed' or 'uploading' state (async Google
 * Ads API call is running in the background Bull worker).
 *
 * Auto-transitions when status reaches 'completed', 'partial', or 'failed'.
 */

import { useEffect, useRef } from 'react';
import { offlineConversionsApi } from '@/lib/api/offlineConversionsApi';
import { useOfflineConversionsStore } from '@/store/offlineConversionsStore';
import type { OfflineConversionUpload } from '@/types/offline-conversions';

const POLL_INTERVAL_MS = 3_000;

/** Terminal statuses — stop polling when reached. */
const TERMINAL_STATUSES = new Set(['completed', 'partial', 'failed', 'cancelled']);

interface Props {
  upload: OfflineConversionUpload;
  onComplete: (upload: OfflineConversionUpload) => void;
}

export function UploadProgress({ upload, onComplete }: Props) {
  const { setActiveUpload } = useOfflineConversionsStore();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortedRef = useRef(false);

  useEffect(() => {
    abortedRef.current = false;

    async function poll() {
      if (abortedRef.current) return;
      try {
        const detail = await offlineConversionsApi.getUploadDetail(upload.id);
        if (abortedRef.current) return;

        setActiveUpload(detail.upload);

        if (TERMINAL_STATUSES.has(detail.upload.status)) {
          onComplete(detail.upload);
          return;
        }
      } catch {
        // Network glitch — keep polling; don't surface transient errors
      }

      if (!abortedRef.current) {
        timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
      }
    }

    // First poll immediately, then on interval
    timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);

    return () => {
      abortedRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [upload.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derive progress counts from the live upload record ───────────────────

  const isUploading = upload.status === 'uploading';
  const totalValid = upload.row_count_valid;
  const uploaded = upload.row_count_uploaded ?? 0;
  const progressPct = totalValid > 0 ? Math.round((uploaded / totalValid) * 100) : 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Sending to Google Ads…</h3>
          <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-xs">{upload.filename}</p>
        </div>
        <span className="shrink-0 text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700 font-medium animate-pulse">
          {isUploading ? 'Uploading' : 'Queued'}
        </span>
      </div>

      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{isUploading ? `${uploaded.toLocaleString()} of ${totalValid.toLocaleString()} rows sent` : 'Waiting for processing slot…'}</span>
          {isUploading && <span>{progressPct}%</span>}
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: isUploading ? `${progressPct}%` : '0%' }}
          />
        </div>
      </div>

      {/* Info */}
      <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 space-y-1">
        <p className="font-medium">Processing in the background</p>
        <p className="text-xs">
          Large files are uploaded in batches of 2,000 rows. You can leave this page — the
          upload will continue and you can check the results in Upload History.
        </p>
      </div>

      {/* Spinner */}
      <div className="flex items-center justify-center py-4">
        <span className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
      </div>
    </div>
  );
}
