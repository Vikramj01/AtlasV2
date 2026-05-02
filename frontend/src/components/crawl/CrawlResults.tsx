import { cn } from '@/lib/utils';
import type { CrawlRunSummary, CrawlPageResult, SignalHealthStatus } from '@/types/crawl';
import { STATUS_LABELS, TOOLTIPS } from '@/lib/ui-copy';
import { InfoTooltip } from '@/components/common/InfoTooltip';

interface CrawlResultsProps {
  run: CrawlRunSummary;
  pages: CrawlPageResult[];
}

const HEALTH_COLOR: Record<SignalHealthStatus, string> = {
  healthy:       'bg-[#D1FAE5] text-[#065F46]',
  degraded:      'bg-[#FEF3C7] text-[#92400E]',
  missing:       'bg-[#FEF2F2] text-[#DC2626]',
  duplicate:     'bg-[#EDE9FE] text-[#5B21B6]',
  misconfigured: 'bg-[#FFF7ED] text-[#C2410C]',
};

function signalStatusLabel(status: SignalHealthStatus): string {
  if (status === 'healthy')                          return STATUS_LABELS.healthy.badge;
  if (status === 'missing')                          return STATUS_LABELS.error.badge;
  if (status === 'degraded' || status === 'misconfigured' || status === 'duplicate') {
    return STATUS_LABELS.warning.badge;
  }
  return status;
}

function signalTooltip(status: SignalHealthStatus): (typeof TOOLTIPS)[keyof typeof TOOLTIPS] {
  if (status === 'healthy') return TOOLTIPS.signalHealthy;
  if (status === 'missing') return TOOLTIPS.signalError;
  return TOOLTIPS.signalWarning;
}

const SIGNAL_LABEL: Record<string, string> = {
  gtm_container:          'GTM',
  ga4_base:               'GA4',
  ga4_event:              'GA4 Event',
  meta_pixel:             'Meta Pixel',
  meta_capi:              'Meta CAPI',
  google_ads_conversion:  'Google Ads Conv.',
  google_ads_remarketing: 'Google Ads Rem.',
  tiktok_pixel:           'TikTok',
  linkedin_insight:       'LinkedIn',
  snapchat_pixel:         'Snapchat',
  custom_event:           'Custom',
};

export function CrawlResults({ run, pages }: CrawlResultsProps) {
  const completedPages = pages.filter(p => p.status === 'completed');

  const totalSignals  = completedPages.reduce((s, p) => s + p.signals_found,   0);
  const totalHealthy  = completedPages.reduce((s, p) => s + p.signals_healthy,  0);
  const totalDegraded = completedPages.reduce((s, p) => s + p.signals_degraded, 0);
  const totalMissing  = completedPages.reduce((s, p) => s + p.signals_missing,  0);

  if (run.status === 'failed') {
    return (
      <div className="rounded-lg border border-[#FEE2E2] bg-[#FEF2F2] p-5 text-sm text-[#DC2626]">
        <p className="font-semibold mb-1">Scan failed</p>
        <p className="text-[#EF4444]">{run.error_message ?? 'An unexpected error occurred.'}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard label="Signals found"  value={totalSignals}  />
        <SummaryCard label="Healthy"        value={totalHealthy}  color="text-[#065F46]" />
        <SummaryCard label="Degraded"       value={totalDegraded} color="text-[#92400E]" />
        <SummaryCard label="Missing"        value={totalMissing}  color="text-[#DC2626]" />
      </div>

      {/* Per-page breakdown */}
      {completedPages.length > 0 && (
        <div className="space-y-3">
          {completedPages.map(page => (
            <PageResultCard key={page.id} page={page} />
          ))}
        </div>
      )}

      {completedPages.length === 0 && (
        <p className="text-sm text-[#9CA3AF] text-center py-6">No completed pages yet.</p>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  color = 'text-[#1A1A1A]',
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white p-4">
      <p className="text-[11px] text-[#6B7280] uppercase tracking-wide mb-1">{label}</p>
      <p className={cn('text-2xl font-bold', color)}>{value}</p>
    </div>
  );
}

function PageResultCard({ page }: { page: CrawlPageResult }) {
  const signals = page.detected_signals ?? [];

  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white overflow-hidden">
      {/* Page header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#E5E7EB] bg-[#F9FAFB]">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-[#1A1A1A] truncate">{formatUrl(page.url)}</p>
          <p className="text-[10px] text-[#9CA3AF] mt-0.5">{page.domain}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0 ml-4">
          {page.http_status && (
            <span className={cn(
              'text-[10px] font-medium px-1.5 py-0.5 rounded',
              page.http_status < 400 ? 'bg-[#D1FAE5] text-[#065F46]' : 'bg-[#FEF2F2] text-[#DC2626]',
            )}>
              HTTP {page.http_status}
            </span>
          )}
          <span className="text-xs text-[#6B7280]">
            {page.signals_found} signal{page.signals_found !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Signal rows */}
      {signals.length > 0 ? (
        <div className="divide-y divide-[#F3F4F6]">
          {signals.map(sig => (
            <div key={sig.id} className="flex items-center justify-between px-4 py-2.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="text-xs font-medium text-[#1A1A1A] shrink-0">
                  {SIGNAL_LABEL[sig.signal_type] ?? sig.signal_type}
                </span>
                {sig.signal_name && (
                  <span className="text-[11px] text-[#6B7280] truncate">{sig.signal_name}</span>
                )}
                {sig.signal_id && (
                  <span className="text-[10px] text-[#9CA3AF] font-mono truncate">{sig.signal_id}</span>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0 ml-3">
                <span className={cn(
                  'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium',
                  HEALTH_COLOR[sig.health_status],
                )}>
                  {signalStatusLabel(sig.health_status)}
                </span>
                <InfoTooltip entry={signalTooltip(sig.health_status)} side="left" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="px-4 py-3 text-xs text-[#9CA3AF]">No signals detected on this page.</p>
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
