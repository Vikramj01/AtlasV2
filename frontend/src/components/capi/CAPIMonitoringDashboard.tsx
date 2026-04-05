/**
 * CAPIMonitoringDashboard
 *
 * Shows delivery analytics for a single CAPI provider over the last 30 days.
 * Fetches from GET /api/capi/providers/:id/dashboard and renders:
 *   - 5 stat cards (total, delivered, failed, delivery rate, avg latency)
 *   - EMQ score card (Meta only — shown when avg_emq is non-null)
 *   - Event breakdown table with per-event success-rate bar
 *   - Day-by-day delivery chart (CSS bar chart, no external lib)
 *
 * Used by CAPIPage when the user clicks a provider card.
 */

import { useEffect } from 'react';
import { capiApi } from '@/lib/api/capiApi';
import { useCAPIStore } from '@/store/capiStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MetricGuidance } from '@/components/shared/MetricGuidance';
import { emqGuidance, capiDeliveryGuidance } from '@/lib/guidance/metricGuidance';
import type { CAPIProviderConfig } from '@/types/capi';

// ── Helpers ───────────────────────────────────────────────────────────────────

const PROVIDER_LABELS: Record<string, string> = {
  meta:     'Meta (Facebook)',
  google:   'Google Ads',
  tiktok:   'TikTok',
  linkedin: 'LinkedIn',
  snapchat: 'Snapchat',
};

const STATUS_COLORS: Record<string, string> = {
  draft:   'bg-gray-100 text-gray-600',
  testing: 'bg-yellow-100 text-yellow-700',
  active:  'bg-green-100 text-green-700',
  paused:  'bg-orange-100 text-orange-700',
  error:   'bg-red-100 text-red-700',
};

function fmt(n: number): string {
  return n.toLocaleString();
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  color = 'default',
}: {
  label: string;
  value: string;
  sub?: string;
  color?: 'green' | 'red' | 'yellow' | 'default';
}) {
  const valueClass =
    color === 'green' ? 'text-green-700' :
    color === 'red'   ? 'text-red-700' :
    color === 'yellow'? 'text-amber-700' :
    'text-foreground';

  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <p className={`text-2xl font-bold tabular-nums ${valueClass}`}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ── Event Breakdown Table ─────────────────────────────────────────────────────

function EventBreakdownTable({
  byEvent,
}: {
  byEvent: Array<{ event_name: string; count: number; success_rate: number }>;
}) {
  if (byEvent.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        No events recorded yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-xs text-muted-foreground uppercase tracking-wide">
            <th className="text-left pb-2 font-medium">Event</th>
            <th className="text-right pb-2 font-medium w-20">Count</th>
            <th className="text-right pb-2 font-medium w-24">Success</th>
            <th className="pb-2 w-40"></th>
          </tr>
        </thead>
        <tbody>
          {byEvent.map((row) => {
            const pctValue = Math.round(row.success_rate * 100);
            const barColor = pctValue >= 95 ? 'bg-green-500' : pctValue >= 80 ? 'bg-amber-400' : 'bg-red-400';
            return (
              <tr key={row.event_name} className="border-b last:border-0">
                <td className="py-2.5 font-mono text-xs">{row.event_name}</td>
                <td className="py-2.5 text-right tabular-nums text-muted-foreground">{fmt(row.count)}</td>
                <td className="py-2.5 text-right tabular-nums font-medium">{pctValue}%</td>
                <td className="py-2.5 pl-3">
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full ${barColor}`}
                      style={{ width: `${pctValue}%` }}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Day-by-Day Chart ──────────────────────────────────────────────────────────

function DailyChart({
  byDay,
}: {
  byDay: Array<{ date: string; delivered: number; failed: number }>;
}) {
  if (byDay.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        No daily data available yet.
      </p>
    );
  }

  const maxTotal = Math.max(...byDay.map((d) => d.delivered + d.failed), 1);

  // Show at most 30 bars; if more, take the last 30
  const days = byDay.slice(-30);

  return (
    <div>
      <div className="flex items-end gap-0.5 h-28 w-full">
        {days.map((day) => {
          const total = day.delivered + day.failed;
          const totalPct = (total / maxTotal) * 100;
          const failedPct = total > 0 ? (day.failed / total) * 100 : 0;
          const deliveredPct = 100 - failedPct;

          return (
            <div
              key={day.date}
              className="flex-1 flex flex-col justify-end group relative"
              title={`${day.date}: ${day.delivered} delivered, ${day.failed} failed`}
            >
              {/* Tooltip */}
              <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center z-10 pointer-events-none">
                <div className="bg-popover border rounded shadow-md text-xs px-2 py-1 whitespace-nowrap text-foreground">
                  <p className="font-medium">{new Date(day.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</p>
                  {day.delivered > 0 && <p className="text-green-600">✓ {fmt(day.delivered)}</p>}
                  {day.failed > 0 && <p className="text-red-600">✗ {fmt(day.failed)}</p>}
                  {total === 0 && <p className="text-muted-foreground">No events</p>}
                </div>
                <div className="w-1.5 h-1.5 rotate-45 bg-popover border-r border-b -mt-1" />
              </div>

              {/* Bar */}
              <div
                className="w-full rounded-t overflow-hidden"
                style={{ height: `${Math.max(totalPct, total > 0 ? 4 : 0)}%` }}
              >
                {/* Failed (red) on top, delivered (green) below */}
                {day.failed > 0 && (
                  <div className="w-full bg-red-400" style={{ height: `${failedPct}%` }} />
                )}
                <div className="w-full bg-green-500" style={{ height: `${deliveredPct}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* X-axis: show first, middle, last date */}
      <div className="flex justify-between mt-1.5 text-xs text-muted-foreground/60">
        <span>{days[0] ? new Date(days[0].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}</span>
        <span>{days[Math.floor(days.length / 2)] ? new Date(days[Math.floor(days.length / 2)].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}</span>
        <span>{days[days.length - 1] ? new Date(days[days.length - 1].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}</span>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-green-500" /> Delivered</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-400" /> Failed</span>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

interface CAPIMonitoringDashboardProps {
  provider: CAPIProviderConfig;
  onBack: () => void;
}

export function CAPIMonitoringDashboard({ provider, onBack }: CAPIMonitoringDashboardProps) {
  const { dashboard, dashboardLoading, setDashboard, setDashboardLoading } = useCAPIStore();

  useEffect(() => {
    setDashboardLoading(true);
    capiApi
      .getDashboard(provider.id, 30)
      .then(setDashboard)
      .catch(() => {})
      .finally(() => setDashboardLoading(false));
  }, [provider.id, setDashboard, setDashboardLoading]);

  function handleRefresh() {
    setDashboardLoading(true);
    capiApi
      .getDashboard(provider.id, 30)
      .then(setDashboard)
      .catch(() => {})
      .finally(() => setDashboardLoading(false));
  }

  const deliveryColor =
    !dashboard ? 'default' :
    dashboard.delivery_rate >= 0.95 ? 'green' :
    dashboard.delivery_rate >= 0.80 ? 'yellow' : 'red';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          >
            ← Back
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">{PROVIDER_LABELS[provider.provider] ?? provider.provider}</h2>
              <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_COLORS[provider.status] ?? 'bg-gray-100 text-gray-600'}`}>
                {provider.status}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">Last 30 days</p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={dashboardLoading}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
        >
          {dashboardLoading ? 'Loading…' : '↻ Refresh'}
        </button>
      </div>

      {dashboardLoading && !dashboard && (
        <div className="flex items-center justify-center py-16">
          <p className="text-sm text-muted-foreground">Loading analytics…</p>
        </div>
      )}

      {dashboard && (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard label="Total Events" value={fmt(dashboard.total_events)} />
            <StatCard
              label="Delivered"
              value={fmt(dashboard.delivered)}
              color={dashboard.delivered > 0 ? 'green' : 'default'}
            />
            <StatCard
              label="Failed"
              value={fmt(dashboard.failed)}
              color={dashboard.failed > 0 ? 'red' : 'default'}
            />
            <StatCard
              label="Delivery Rate"
              value={pct(dashboard.delivery_rate)}
              color={deliveryColor}
            />
            <StatCard
              label="Avg Latency"
              value={dashboard.avg_latency_ms < 1000
                ? `${Math.round(dashboard.avg_latency_ms)}ms`
                : `${(dashboard.avg_latency_ms / 1000).toFixed(1)}s`}
              sub={dashboard.blocked_by_consent > 0 ? `${fmt(dashboard.blocked_by_consent)} consent-blocked` : undefined}
            />
          </div>

          {/* EMQ score — Meta only */}
          {dashboard.avg_emq !== null && (
            <div className="space-y-3">
              <div className="rounded-xl border border-brand-200 bg-brand-50 px-5 py-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-brand-800">Event Match Quality</p>
                  <p className="text-xs text-brand-700 mt-0.5">
                    Higher scores mean Meta can match more conversions to the right ads.
                    Improve by sending email, phone, and click IDs.
                  </p>
                </div>
                <div className="text-right shrink-0 ml-6">
                  <p className={`text-3xl font-bold tabular-nums ${
                    dashboard.avg_emq >= 7 ? 'text-green-600' :
                    dashboard.avg_emq >= 5 ? 'text-amber-600' :
                    'text-red-600'
                  }`}>
                    {dashboard.avg_emq.toFixed(1)}
                  </p>
                  <p className="text-xs text-brand-600">/ 10</p>
                </div>
              </div>
              <MetricGuidance result={emqGuidance(dashboard.avg_emq)} collapsible />
            </div>
          )}

          {/* Delivery rate guidance */}
          <MetricGuidance
            result={capiDeliveryGuidance(Math.round(dashboard.delivery_rate * 100))}
            collapsible
          />

          {/* Event breakdown */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Event Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <EventBreakdownTable byEvent={dashboard.by_event} />
            </CardContent>
          </Card>

          {/* Daily chart */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Daily Delivery</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <DailyChart byDay={dashboard.by_day} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
