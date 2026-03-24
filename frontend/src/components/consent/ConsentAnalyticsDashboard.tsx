'use client';

/**
 * ConsentAnalyticsDashboard
 *
 * Shows opt-in rates, by-category table, daily chart, and by-country table
 * for a given project. Fetches from consentApi.getAnalytics().
 */

import { useEffect, useState } from 'react';
import { consentApi } from '@/lib/api/consentApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ConsentAnalyticsResponse, ConsentCategory } from '@/types/consent';

// ── Types ─────────────────────────────────────────────────────────────────────

type Period = '7d' | '30d' | '90d';

interface ConsentAnalyticsDashboardProps {
  projectId: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const PERIOD_LABELS: Record<Period, string> = {
  '7d':  '7 days',
  '30d': '30 days',
  '90d': '90 days',
};

const CATEGORIES: ConsentCategory[] = ['analytics', 'marketing', 'personalisation', 'functional'];

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <div className="h-3 w-24 rounded bg-muted animate-pulse mb-2" />
        <div className="h-8 w-16 rounded bg-muted animate-pulse" />
      </CardContent>
    </Card>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <p className="text-2xl font-bold tabular-nums text-foreground">{value}</p>
      </CardContent>
    </Card>
  );
}

function CategoryTable({ optInRate }: { optInRate: Record<ConsentCategory, number> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-xs text-muted-foreground uppercase tracking-wide">
            <th className="text-left pb-2 font-medium">Category</th>
            <th className="text-right pb-2 font-medium w-24">Opt-in Rate</th>
            <th className="pb-2 w-48"></th>
          </tr>
        </thead>
        <tbody>
          {CATEGORIES.map((cat) => {
            const rate = optInRate[cat] ?? 0;
            const pctValue = Math.round(rate * 100);
            const barColor =
              pctValue >= 70 ? 'bg-green-500' :
              pctValue >= 50 ? 'bg-amber-400' :
              'bg-red-400';
            return (
              <tr key={cat} className="border-b last:border-0">
                <td className="py-2.5 capitalize font-medium">{cat}</td>
                <td className="py-2.5 text-right tabular-nums">{pctValue}%</td>
                <td className="py-2.5 pl-3">
                  <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
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

function DailyConsentChart({
  byDay,
}: {
  byDay: Array<{ date: string; granted: number; denied: number }>;
}) {
  if (byDay.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        No daily data available yet.
      </p>
    );
  }

  const days = byDay.slice(-30);
  const maxTotal = Math.max(...days.map((d) => d.granted + d.denied), 1);

  return (
    <div>
      <div className="flex items-end gap-0.5 h-28 w-full">
        {days.map((day) => {
          const total = day.granted + day.denied;
          const totalPct = (total / maxTotal) * 100;
          const deniedPct = total > 0 ? (day.denied / total) * 100 : 0;
          const grantedPct = 100 - deniedPct;

          return (
            <div
              key={day.date}
              className="flex-1 flex flex-col justify-end group relative"
              title={`${day.date}: ${day.granted} granted, ${day.denied} denied`}
            >
              {/* Tooltip */}
              <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center z-10 pointer-events-none">
                <div className="bg-popover border rounded shadow-md text-xs px-2 py-1 whitespace-nowrap text-foreground">
                  <p className="font-medium">
                    {new Date(day.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </p>
                  {day.granted > 0 && <p className="text-green-600">✓ {day.granted.toLocaleString()}</p>}
                  {day.denied > 0 && <p className="text-red-600">✗ {day.denied.toLocaleString()}</p>}
                  {total === 0 && <p className="text-muted-foreground">No decisions</p>}
                </div>
                <div className="w-1.5 h-1.5 rotate-45 bg-popover border-r border-b -mt-1" />
              </div>

              {/* Bar */}
              <div
                className="w-full rounded-t overflow-hidden"
                style={{ height: `${Math.max(totalPct, total > 0 ? 4 : 0)}%` }}
              >
                {/* Denied (red) on top */}
                {day.denied > 0 && (
                  <div className="w-full bg-red-400" style={{ height: `${deniedPct}%` }} />
                )}
                <div className="w-full bg-green-500" style={{ height: `${grantedPct}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* X-axis */}
      <div className="flex justify-between mt-1.5 text-xs text-muted-foreground/60">
        <span>
          {days[0]
            ? new Date(days[0].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
            : ''}
        </span>
        <span>
          {days[Math.floor(days.length / 2)]
            ? new Date(days[Math.floor(days.length / 2)].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
            : ''}
        </span>
        <span>
          {days[days.length - 1]
            ? new Date(days[days.length - 1].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
            : ''}
        </span>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-green-500" /> Granted
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-400" /> Denied
        </span>
      </div>
    </div>
  );
}

function CountryTable({
  byCountry,
}: {
  byCountry: Array<{ country: string; opt_in_rate: number; total: number }>;
}) {
  const top10 = byCountry.slice(0, 10);

  if (top10.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        No country data available yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-xs text-muted-foreground uppercase tracking-wide">
            <th className="text-left pb-2 font-medium">Country</th>
            <th className="text-right pb-2 font-medium w-24">Total</th>
            <th className="text-right pb-2 font-medium w-24">Opt-in Rate</th>
          </tr>
        </thead>
        <tbody>
          {top10.map((row) => (
            <tr key={row.country} className="border-b last:border-0">
              <td className="py-2.5">{row.country || 'Unknown'}</td>
              <td className="py-2.5 text-right tabular-nums text-muted-foreground">
                {row.total.toLocaleString()}
              </td>
              <td className="py-2.5 text-right tabular-nums font-medium">
                {Math.round(row.opt_in_rate * 100)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function ConsentAnalyticsDashboard({ projectId }: ConsentAnalyticsDashboardProps) {
  const [period, setPeriod] = useState<Period>('30d');
  const [data, setData] = useState<ConsentAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    consentApi
      .getAnalytics(projectId, { period })
      .then(setData)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load consent analytics.');
      })
      .finally(() => setLoading(false));
  }, [projectId, period]);

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="flex gap-1">
        {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPeriod(p)}
            className={`px-3 py-1.5 text-sm rounded-full font-medium transition-colors ${
              period === p
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>

      {/* Error state */}
      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">
          {error}
        </div>
      )}

      {/* Loading: skeleton cards */}
      {loading && !data && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {/* Data */}
      {data && (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              label="Total Decisions"
              value={data.total_decisions.toLocaleString()}
            />
            <StatCard
              label="Analytics Opt-in"
              value={pct(data.opt_in_rate.analytics ?? 0)}
            />
            <StatCard
              label="Marketing Opt-in"
              value={pct(data.opt_in_rate.marketing ?? 0)}
            />
            <StatCard
              label="Consent Coverage"
              value={pct(data.consent_coverage)}
            />
          </div>

          {/* Per-category table */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Opt-in by Category</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <CategoryTable optInRate={data.opt_in_rate} />
            </CardContent>
          </Card>

          {/* Daily chart */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Daily Decisions (last 30 days)</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <DailyConsentChart byDay={data.by_day} />
            </CardContent>
          </Card>

          {/* By-country table */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Top Countries</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <CountryTable byCountry={data.by_country} />
            </CardContent>
          </Card>
        </>
      )}

      {/* No data yet (after load, no error, no data) */}
      {!loading && !error && !data && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <p className="text-muted-foreground text-sm">No analytics data available yet.</p>
            <p className="text-xs text-muted-foreground">
              Data will appear once visitors start interacting with your consent banner.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
