import { useEffect, useState } from 'react';
import { X, ChevronDown, ChevronUp } from 'lucide-react';
import { adminApi } from '@/lib/api/adminApi';
import { CostTrendChart } from './CostTrendChart';
import type { UsagePortfolioRow, OrgUsageSummary, UsageEvent } from '@/types/usage';

interface Props {
  row: UsagePortfolioRow;
  month: string;
  onClose: () => void;
}

const AI_TYPE_LABELS: Record<string, string> = {
  ai_report_scheduled: 'Scheduled report',
  ai_report_ondemand:  'On-demand report',
  ai_query_ondemand:   'On-demand query',
};

function fmt(n: number) {
  if (n === 0) return '$0';
  if (n < 0.001) return `$${n.toFixed(6)}`;
  if (n < 0.01)  return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

export function OrgUsageDrillDown({ row, month, onClose }: Props) {
  const [summary, setSummary] = useState<OrgUsageSummary | null>(null);
  const [events, setEvents] = useState<UsageEvent[]>([]);
  const [eventsTotal, setEventsTotal] = useState(0);
  const [eventsPage, setEventsPage] = useState(1);
  const [showEvents, setShowEvents] = useState(false);
  const [loading, setLoading] = useState(true);
  const [eventsLoading, setEventsLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    adminApi.getOrgUsage(row.org_id, month)
      .then((res) => setSummary(res.data))
      .catch(() => {/* silent */})
      .finally(() => setLoading(false));
  }, [row.org_id, month]);

  function loadEvents(page: number) {
    setEventsLoading(true);
    adminApi.getOrgEvents(row.org_id, { page })
      .then((res) => {
        setEvents(res.data.events);
        setEventsTotal(res.data.total);
        setEventsPage(page);
      })
      .catch(() => {/* silent */})
      .finally(() => setEventsLoading(false));
  }

  function toggleEvents() {
    if (!showEvents && events.length === 0) loadEvents(1);
    setShowEvents((v) => !v);
  }

  const PLAN_COLORS: Record<string, string> = {
    free:   'bg-gray-100 text-gray-600',
    pro:    'bg-blue-100 text-blue-700',
    agency: 'bg-purple-100 text-purple-700',
  };

  return (
    <div className="mt-4 rounded-xl border bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-5 py-4">
        <div className="flex items-center gap-3">
          <div>
            <h3 className="font-semibold text-foreground">{row.org_name}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {row.total_page_scans.toLocaleString()} scans · {row.total_ai_calls.toLocaleString()} AI calls · total {fmt(row.total_variable_cost_usd)} MTD
            </p>
          </div>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PLAN_COLORS[row.plan] ?? 'bg-gray-100'}`}>
            {row.plan}
          </span>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          aria-label="Close drill-down"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          Loading…
        </div>
      ) : summary ? (
        <div className="p-5 space-y-6">
          {/* 30-day cost trend */}
          <div>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              30-day cost trend
            </h4>
            <CostTrendChart data={summary.daily} />
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {/* Top domains */}
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Top domains by scan cost
              </h4>
              {summary.domains.length === 0 ? (
                <p className="text-sm text-muted-foreground">No scan data this month.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b">
                      <th className="pb-1.5 font-medium">Domain</th>
                      <th className="pb-1.5 font-medium text-right">Scans</th>
                      <th className="pb-1.5 font-medium text-right">Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {summary.domains.map((d) => (
                      <tr key={d.domain} className="text-foreground">
                        <td className="py-1.5 truncate max-w-[160px]" title={d.domain}>{d.domain}</td>
                        <td className="py-1.5 text-right tabular-nums text-muted-foreground">{d.scan_count}</td>
                        <td className="py-1.5 text-right tabular-nums">{fmt(d.cost_usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* AI call breakdown */}
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                AI call breakdown
              </h4>
              {summary.ai_breakdown.length === 0 ? (
                <p className="text-sm text-muted-foreground">No AI calls this month.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b">
                      <th className="pb-1.5 font-medium">Type</th>
                      <th className="pb-1.5 font-medium text-right">Calls</th>
                      <th className="pb-1.5 font-medium text-right">Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {summary.ai_breakdown.map((a) => (
                      <tr key={a.event_type} className="text-foreground">
                        <td className="py-1.5 text-muted-foreground">
                          {AI_TYPE_LABELS[a.event_type] ?? a.event_type}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">{a.call_count}</td>
                        <td className="py-1.5 text-right tabular-nums">{fmt(a.cost_usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Raw events (collapsible) */}
          <div>
            <button
              onClick={toggleEvents}
              className="flex w-full items-center justify-between rounded-lg border px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <span>Raw event log {eventsTotal > 0 ? `(${eventsTotal.toLocaleString()} events)` : ''}</span>
              {showEvents ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>

            {showEvents && (
              <div className="mt-2 overflow-x-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-[#F9FAFB] text-left text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Type</th>
                      <th className="px-3 py-2 font-medium text-right">Cost</th>
                      <th className="px-3 py-2 font-medium text-right">Scans</th>
                      <th className="px-3 py-2 font-medium text-right">Input tok</th>
                      <th className="px-3 py-2 font-medium text-right">Output tok</th>
                      <th className="px-3 py-2 font-medium">Domain / Model</th>
                      <th className="px-3 py-2 font-medium">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {eventsLoading ? (
                      <tr>
                        <td colSpan={7} className="px-3 py-4 text-center text-muted-foreground">Loading…</td>
                      </tr>
                    ) : events.map((e) => (
                      <tr key={e.id} className="hover:bg-gray-50/50">
                        <td className="px-3 py-1.5">
                          <span className={`rounded px-1.5 py-0.5 font-medium ${e.event_type === 'page_scan' ? 'bg-blue-50 text-blue-700' : 'bg-violet-50 text-violet-700'}`}>
                            {e.event_type}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{fmt(e.cost_usd)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{e.pages_scanned ?? '—'}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{e.input_tokens?.toLocaleString() ?? '—'}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{e.output_tokens?.toLocaleString() ?? '—'}</td>
                        <td className="px-3 py-1.5 text-muted-foreground truncate max-w-[140px]" title={e.domain ?? e.model ?? ''}>
                          {e.domain ?? e.model ?? '—'}
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">
                          {new Date(e.created_at).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Pagination */}
                {eventsTotal > 50 && (
                  <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
                    <span>
                      {(eventsPage - 1) * 50 + 1}–{Math.min(eventsPage * 50, eventsTotal)} of {eventsTotal.toLocaleString()}
                    </span>
                    <div className="flex gap-2">
                      <button
                        disabled={eventsPage <= 1}
                        onClick={() => loadEvents(eventsPage - 1)}
                        className="disabled:opacity-40 hover:text-foreground transition-colors"
                      >
                        ← Prev
                      </button>
                      <button
                        disabled={eventsPage * 50 >= eventsTotal}
                        onClick={() => loadEvents(eventsPage + 1)}
                        className="disabled:opacity-40 hover:text-foreground transition-colors"
                      >
                        Next →
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          Failed to load usage data.
        </div>
      )}
    </div>
  );
}
