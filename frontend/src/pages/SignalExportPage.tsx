import { useState, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Download, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { signalEventsApi } from '@/lib/api/signalEventsApi';
import type { ExportJob } from '@/types/signal-tracking';

function toDatetimeLocal(iso: string): string {
  // Trim to "YYYY-MM-DDTHH:MM" for datetime-local input
  return iso.slice(0, 16);
}

function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return toDatetimeLocal(d.toISOString());
}

function defaultTo(): string {
  return toDatetimeLocal(new Date().toISOString());
}

export function SignalExportPage() {
  const [searchParams] = useSearchParams();

  const [from, setFrom] = useState(() => {
    const p = searchParams.get('from');
    return p ? toDatetimeLocal(p) : defaultFrom();
  });
  const [to, setTo] = useState(() => {
    const p = searchParams.get('to');
    return p ? toDatetimeLocal(p) : defaultTo();
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [exportJob, setExportJob]       = useState<ExportJob | null>(null);
  const [error, setError]               = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll while job is in-flight
  useEffect(() => {
    if (!exportJob || exportJob.status === 'completed' || exportJob.status === 'failed') {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }

    pollRef.current = setInterval(async () => {
      try {
        const res = await signalEventsApi.pollExport(exportJob.id);
        setExportJob(res.data);
      } catch {
        // non-fatal — keep polling
      }
    }, 5000);

    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [exportJob]);

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const fromISO = new Date(from).toISOString();
      const toISO   = new Date(to).toISOString();

      const res = await signalEventsApi.createExport({ from: fromISO, to: toISO });
      setExportJob({
        id:            res.data.job_id,
        status:        'pending',
        download_url:  null,
        expires_at:    null,
        error_message: null,
        created_at:    new Date().toISOString(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleReset() {
    setExportJob(null);
    setError(null);
  }

  const inProgress = exportJob && (exportJob.status === 'pending' || exportJob.status === 'processing');
  const completed  = exportJob?.status === 'completed';
  const failed     = exportJob?.status === 'failed';

  return (
    <div className="flex flex-col gap-4 px-6 py-4 max-w-2xl">
      {/* Back nav */}
      <Link
        to="/signal-tracking"
        className="flex items-center gap-1.5 text-xs text-[#6B7280] hover:text-[#374151] w-fit"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Signal Tracking
      </Link>

      {/* Header */}
      <section className="rounded-lg border border-[#E5E7EB] bg-white px-4 py-3">
        <h1 className="text-base font-semibold text-[#1A1A1A]">Export Signals</h1>
        <p className="text-xs text-[#6B7280] mt-0.5">
          Download a CSV of outbound conversion signals for analysis or archiving. Exports are capped at 100,000 rows.
        </p>
      </section>

      {/* Form — only shown before job is submitted */}
      {!exportJob && (
        <section className="rounded-lg border border-[#E5E7EB] bg-white px-4 py-4">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-[#374151]" htmlFor="export-from">
                  From
                </label>
                <input
                  id="export-from"
                  type="datetime-local"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  required
                  className="rounded-md border border-[#E5E7EB] px-3 py-1.5 text-xs text-[#374151] focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/30"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-[#374151]" htmlFor="export-to">
                  To
                </label>
                <input
                  id="export-to"
                  type="datetime-local"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  required
                  className="rounded-md border border-[#E5E7EB] px-3 py-1.5 text-xs text-[#374151] focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/30"
                />
              </div>
            </div>

            {error && (
              <p className="rounded-md border border-[#FEE2E2] bg-[#FEF2F2] px-3 py-2 text-xs text-[#DC2626]">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="self-start flex items-center gap-1.5 rounded-md bg-[#1B2A4A] px-4 py-1.5 text-xs font-medium text-white hover:bg-[#2d3f63] disabled:opacity-50 transition-colors"
            >
              {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isSubmitting ? 'Starting…' : 'Start Export'}
            </button>
          </form>
        </section>
      )}

      {/* Job status card */}
      {exportJob && (
        <section className="rounded-lg border border-[#E5E7EB] bg-white px-4 py-4">
          {inProgress && (
            <div className="flex flex-col items-center gap-3 py-4">
              <Loader2 className="h-7 w-7 animate-spin text-[#1B2A4A]" />
              <p className="text-sm font-medium text-[#374151]">
                {exportJob.status === 'pending' ? 'Queued — export will begin shortly…' : 'Building your CSV…'}
              </p>
              <p className="text-xs text-[#9CA3AF]">This page will update automatically. You can leave and come back.</p>
            </div>
          )}

          {completed && exportJob.download_url && (
            <div className="flex flex-col items-center gap-3 py-4">
              <CheckCircle className="h-7 w-7 text-[#16A34A]" />
              <p className="text-sm font-medium text-[#374151]">Your export is ready</p>
              {exportJob.expires_at && (
                <p className="text-xs text-[#9CA3AF]">
                  Link expires {new Date(exportJob.expires_at).toLocaleString()}
                </p>
              )}
              <a
                href={exportJob.download_url}
                download
                className="flex items-center gap-1.5 rounded-md bg-[#1B2A4A] px-4 py-1.5 text-xs font-medium text-white hover:bg-[#2d3f63] transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                Download CSV
              </a>
              <button
                onClick={handleReset}
                className="text-xs text-[#6B7280] underline hover:text-[#374151]"
              >
                Start a new export
              </button>
            </div>
          )}

          {failed && (
            <div className="flex flex-col items-center gap-3 py-4">
              <XCircle className="h-7 w-7 text-[#DC2626]" />
              <p className="text-sm font-medium text-[#374151]">Export failed</p>
              {exportJob.error_message && (
                <p className="text-xs text-[#6B7280]">{exportJob.error_message}</p>
              )}
              <button
                onClick={handleReset}
                className="rounded-md border border-[#E5E7EB] px-3 py-1.5 text-xs font-medium text-[#374151] hover:border-[#9CA3AF] transition-colors"
              >
                Try again
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
