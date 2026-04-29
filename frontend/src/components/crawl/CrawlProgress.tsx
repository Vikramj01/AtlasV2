import { cn } from '@/lib/utils';
import type { CrawlRunSummary, CrawlPageResult, CrawlPageStatus } from '@/types/crawl';

interface CrawlProgressProps {
  run: CrawlRunSummary;
  pages: CrawlPageResult[];
}

const PAGE_STATUS_LABEL: Record<CrawlPageStatus, string> = {
  pending:   'Pending',
  scanning:  'Scanning…',
  completed: 'Done',
  failed:    'Failed',
  skipped:   'Skipped',
};

const PAGE_STATUS_COLOR: Record<CrawlPageStatus, string> = {
  pending:   'bg-[#E5E7EB] text-[#6B7280]',
  scanning:  'bg-[#EEF1F7] text-[#1B2A4A]',
  completed: 'bg-[#D1FAE5] text-[#065F46]',
  failed:    'bg-[#FEF2F2] text-[#DC2626]',
  skipped:   'bg-[#F3F4F6] text-[#9CA3AF]',
};

const RUN_STATUS_MESSAGE: Record<string, string> = {
  queued:    'Queued — waiting to start…',
  running:   'Scanning your pages…',
  completed: 'Scan complete',
  partial:   'Scan complete with some errors',
  failed:    'Scan failed',
};

export function CrawlProgress({ run, pages }: CrawlProgressProps) {
  const total     = run.total_pages || 1; // avoid divide-by-zero
  const completed = run.pages_completed;
  const pct       = Math.round((completed / total) * 100);
  const isActive  = run.status === 'queued' || run.status === 'running';

  return (
    <div className="space-y-5">

      {/* Status message */}
      <div className="flex items-center gap-3">
        {isActive && (
          <span className="relative flex h-3 w-3 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#1B2A4A] opacity-40" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-[#1B2A4A]" />
          </span>
        )}
        <p className="text-sm font-medium text-[#1A1A1A]">
          {RUN_STATUS_MESSAGE[run.status] ?? 'Processing…'}
        </p>
      </div>

      {/* Progress bar */}
      <div>
        <div className="mb-1.5 flex items-center justify-between text-xs text-[#6B7280]">
          <span>{completed} of {run.total_pages} pages scanned</span>
          <span className="font-semibold text-[#1A1A1A]">{pct}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-[#EEF1F7]">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-700 ease-in-out',
              run.status === 'failed' ? 'bg-[#DC2626]' : 'bg-[#1B2A4A]',
            )}
            style={{ width: `${Math.max(2, pct)}%` }}
          />
        </div>
      </div>

      {/* Per-page list */}
      {pages.length > 0 && (
        <div className="rounded-lg border border-[#E5E7EB] overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_auto_auto] gap-4 px-4 py-2.5 bg-[#F9FAFB] border-b border-[#E5E7EB] text-xs font-medium text-[#6B7280] uppercase tracking-wide">
            <span>Page</span>
            <span className="text-right">Signals</span>
            <span className="text-right w-20">Status</span>
          </div>

          {pages.map(page => (
            <div
              key={page.id}
              className="grid grid-cols-[1fr_auto_auto] gap-4 items-center px-4 py-3 border-b border-[#E5E7EB] last:border-0 hover:bg-[#F9FAFB] transition-colors"
            >
              {/* URL */}
              <div className="min-w-0">
                <p className="text-xs font-medium text-[#1A1A1A] truncate">{formatUrl(page.url)}</p>
                <p className="text-[10px] text-[#9CA3AF] mt-0.5">{page.domain}</p>
              </div>

              {/* Signal count */}
              <span className="text-xs text-[#6B7280] text-right">
                {page.status === 'completed' ? page.signals_found : '—'}
              </span>

              {/* Status badge */}
              <span className={cn(
                'inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[10px] font-medium w-20 text-center',
                PAGE_STATUS_COLOR[page.status],
              )}>
                {PAGE_STATUS_LABEL[page.status]}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Placeholder rows while pages aren't loaded yet */}
      {pages.length === 0 && run.total_pages > 0 && (
        <div className="rounded-lg border border-[#E5E7EB] overflow-hidden">
          {Array.from({ length: Math.min(run.total_pages, 6) }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-[#E5E7EB] last:border-0">
              <div className="h-3 rounded bg-gray-100 animate-pulse flex-1" />
              <div className="h-5 w-16 rounded-full bg-gray-100 animate-pulse" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname === '/' ? u.hostname : `${u.hostname}${u.pathname}`;
  } catch {
    return url;
  }
}
