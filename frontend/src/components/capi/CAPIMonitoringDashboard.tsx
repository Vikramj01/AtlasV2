/**
 * CAPIMonitoringDashboard
 *
 * Shows delivery analytics for a single CAPI provider.
 *
 * Design spec (Sprint 5):
 *   - SVG area chart: delivered = navy fill, failed = light red (#FEE2E2 fill / #DC2626 line)
 *   - 7-day default window with 7d/30d toggle
 *   - EMQ score card: navy palette
 *   - Stat cells: design-system severity tinting
 *   - ErrorLog integrated at the bottom
 */

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { capiApi } from '@/lib/api/capiApi';
import { useCAPIStore } from '@/store/capiStore';
import { MetricGuidance } from '@/components/shared/MetricGuidance';
import { emqGuidance, capiDeliveryGuidance } from '@/lib/guidance/metricGuidance';
import { ErrorLog } from '@/components/capi/ErrorLog';
import { SkeletonCard } from '@/components/common/SkeletonCard';
import type { CAPIProviderConfig } from '@/types/capi';

// ── Constants ────────────────────────────────────────────────────────────────

const NAVY     = '#1B2A4A';
const NAVY_10  = '#EEF1F7';          // navy @ 10% for fills / backgrounds
const RED      = '#DC2626';
const RED_10   = '#FEE2E2';          // light red fill for failed area
const GREEN    = '#059669';
const AMBER    = '#D97706';

const PROVIDER_LABELS: Record<string, string> = {
  meta:     'Meta (Facebook)',
  google:   'Google Ads',
  tiktok:   'TikTok',
  linkedin: 'LinkedIn',
  snapchat: 'Snapchat',
};

const STATUS_STYLES: Record<string, { bg: string; color: string }> = {
  draft:   { bg: '#F3F4F6', color: '#6B7280' },
  testing: { bg: '#FEF3C7', color: '#D97706' },
  active:  { bg: '#F0FDF4', color: '#059669' },
  paused:  { bg: '#FFF7ED', color: '#C2410C' },
  error:   { bg: '#FEF2F2', color: '#DC2626' },
};

function fmt(n: number): string { return n.toLocaleString(); }
function pct(n: number): string { return `${(n * 100).toFixed(1)}%`; }

// ── Stat cell ────────────────────────────────────────────────────────────────

function StatCell({
  label,
  value,
  sub,
  valueColor,
  bg,
  borderColor,
}: {
  label: string;
  value: string;
  sub?: string;
  valueColor?: string;
  bg?: string;
  borderColor?: string;
}) {
  return (
    <div
      className="rounded-lg border px-4 py-3"
      style={{ backgroundColor: bg ?? '#fff', borderColor: borderColor ?? '#E5E7EB' }}
    >
      <p className="text-caption-upper mb-1">{label}</p>
      <p
        className="text-2xl font-semibold tabular-nums"
        style={{ color: valueColor ?? '#1A1A1A' }}
      >
        {value}
      </p>
      {sub && <p className="text-xs text-[#9CA3AF] mt-0.5">{sub}</p>}
    </div>
  );
}

// ── SVG Area Chart ────────────────────────────────────────────────────────────

const CHART_W  = 600;
const CHART_H  = 120;
const PAD_L    = 32;   // Y-axis label space
const PAD_B    = 24;   // X-axis label space
const PAD_T    = 8;

function DeliveryAreaChart({
  byDay,
}: {
  byDay: Array<{ date: string; delivered: number; failed: number }>;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (byDay.length === 0) {
    return (
      <p className="text-sm text-[#9CA3AF] py-4 text-center">No daily data available yet.</p>
    );
  }

  const days = byDay;
  const n    = days.length;
  const maxTotal = Math.max(...days.map((d) => d.delivered + d.failed), 1);

  const innerW = CHART_W - PAD_L;
  const innerH = CHART_H - PAD_T - PAD_B;

  function xAt(i: number) {
    return PAD_L + (i / Math.max(n - 1, 1)) * innerW;
  }
  function yAt(v: number) {
    return PAD_T + innerH - (v / maxTotal) * innerH;
  }

  // Build SVG path strings for delivered and (delivered + failed)
  const deliveredPts = days.map((d, i) => `${xAt(i)},${yAt(d.delivered)}`);
  const totalPts     = days.map((d, i) => `${xAt(i)},${yAt(d.delivered + d.failed)}`);

  const baseline = `${xAt(n - 1)},${PAD_T + innerH} ${xAt(0)},${PAD_T + innerH}`;

  const deliveredArea = `M ${deliveredPts.join(' L ')} L ${baseline} Z`;
  const failedArea    = `M ${totalPts.join(' L ')} L ${deliveredPts.slice().reverse().join(' L ')} Z`;
  const deliveredLine = `M ${deliveredPts.join(' L ')}`;
  const totalLine     = `M ${totalPts.join(' L ')}`;

  // X-axis: first, middle, last
  const labelIdxs = [0, Math.floor(n / 2), n - 1];

  function shortDate(iso: string) {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  // Hover tooltip
  const hDay = hovered !== null ? days[hovered] : null;
  const hX   = hovered !== null ? xAt(hovered) : 0;
  const hY   = hovered !== null
    ? yAt((days[hovered].delivered + days[hovered].failed))
    : 0;

  return (
    <div>
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="w-full"
        style={{ height: 130 }}
        onMouseLeave={() => setHovered(null)}
      >
        {/* ── Grid lines at 25/50/75% ──────────────────────────────────── */}
        {[0.25, 0.5, 0.75].map((frac) => {
          const y = PAD_T + innerH - frac * innerH;
          return (
            <g key={frac}>
              <line x1={PAD_L} y1={y} x2={CHART_W} y2={y} stroke="#E5E7EB" strokeDasharray="4 3" />
            </g>
          );
        })}

        {/* ── Failed area (light red, stacked on top of delivered) ──────── */}
        <defs>
          <linearGradient id="failedGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={RED}    stopOpacity="0.18" />
            <stop offset="100%" stopColor={RED}    stopOpacity="0.04" />
          </linearGradient>
          <linearGradient id="delivGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={NAVY}   stopOpacity="0.14" />
            <stop offset="100%" stopColor={NAVY}   stopOpacity="0.02" />
          </linearGradient>
        </defs>

        <path d={failedArea}    fill="url(#failedGrad)" />
        <path d={deliveredArea} fill="url(#delivGrad)"  />

        {/* ── Lines ────────────────────────────────────────────────────── */}
        <path d={totalLine}     fill="none" stroke={RED}  strokeWidth="1.5" strokeOpacity="0.7" />
        <path d={deliveredLine} fill="none" stroke={NAVY} strokeWidth="2"   />

        {/* ── Hover hit targets ─────────────────────────────────────────── */}
        {days.map((_, i) => (
          <rect
            key={i}
            x={xAt(i) - (innerW / n) / 2}
            y={PAD_T}
            width={innerW / n}
            height={innerH}
            fill="transparent"
            onMouseEnter={() => setHovered(i)}
          />
        ))}

        {/* ── Hover dot + tooltip ───────────────────────────────────────── */}
        {hDay && (
          <g>
            <circle cx={hX} cy={hY} r={4} fill={NAVY} />
            <foreignObject
              x={Math.min(hX - 56, CHART_W - 124)}
              y={Math.max(hY - 60, 0)}
              width={120}
              height={54}
            >
              <div
                style={{
                  background: NAVY,
                  color: '#fff',
                  borderRadius: 6,
                  padding: '5px 8px',
                  fontSize: 11,
                  lineHeight: 1.5,
                }}
              >
                <div style={{ fontWeight: 600 }}>{shortDate(hDay.date)}</div>
                <div style={{ color: NAVY_10 }}>✓ {fmt(hDay.delivered)}</div>
                {hDay.failed > 0 && <div style={{ color: RED_10 }}>✗ {fmt(hDay.failed)}</div>}
              </div>
            </foreignObject>
          </g>
        )}

        {/* ── X-axis labels ─────────────────────────────────────────────── */}
        {labelIdxs.map((i) => (
          <text
            key={i}
            x={xAt(i)}
            y={CHART_H - 2}
            textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
            fontSize={10}
            fill="#9CA3AF"
          >
            {shortDate(days[i]?.date ?? '')}
          </text>
        ))}
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-1 text-xs text-[#9CA3AF]">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-1.5 rounded-full" style={{ backgroundColor: NAVY }} />
          Delivered
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-1.5 rounded-full" style={{ backgroundColor: RED, opacity: 0.7 }} />
          Failed
        </span>
      </div>
    </div>
  );
}

// ── Event Breakdown Table ─────────────────────────────────────────────────────

function EventBreakdownTable({
  byEvent,
}: {
  byEvent: Array<{ event_name: string; count: number; success_rate: number }>;
}) {
  if (byEvent.length === 0) {
    return <p className="text-sm text-[#9CA3AF] py-4 text-center">No events recorded yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#E5E7EB]" style={{ backgroundColor: '#F9FAFB' }}>
            <th className="text-left px-0 py-2.5 text-caption-upper">Event</th>
            <th className="text-right py-2.5 text-caption-upper w-20">Count</th>
            <th className="text-right py-2.5 text-caption-upper w-24">Success</th>
            <th className="py-2.5 w-40" />
          </tr>
        </thead>
        <tbody>
          {byEvent.map((row) => {
            const p = Math.round(row.success_rate * 100);
            const color = p >= 95 ? GREEN : p >= 80 ? AMBER : RED;
            return (
              <tr key={row.event_name} className="border-b border-[#E5E7EB] last:border-0">
                <td className="py-2.5 font-mono text-xs text-[#1A1A1A]">{row.event_name}</td>
                <td className="py-2.5 text-right tabular-nums text-[#9CA3AF]">{fmt(row.count)}</td>
                <td className="py-2.5 text-right tabular-nums font-semibold" style={{ color }}>{p}%</td>
                <td className="py-2.5 pl-3">
                  <div className="h-1.5 w-full rounded-full bg-[#EEF1F7] overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${p}%`, backgroundColor: color }} />
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

// ── EMQ Score Card ────────────────────────────────────────────────────────────

function EMQCard({ score }: { score: number }) {
  const color = score >= 7 ? GREEN : score >= 5 ? AMBER : RED;
  const thumbPct = Math.min(Math.max((score / 10) * 100, 0), 100);

  return (
    <div
      className="rounded-lg border px-5 py-4 flex items-center justify-between gap-6"
      style={{ backgroundColor: NAVY_10, borderColor: `${NAVY}20` }}
    >
      {/* Left: label + bar */}
      <div className="flex-1 min-w-0">
        <p className="text-section-header" style={{ color: NAVY }}>Event Match Quality</p>
        <p className="text-xs text-[#6B7280] mt-0.5 mb-3">
          Higher scores mean better ad attribution. Improve by sending email, phone, and click IDs.
        </p>

        {/* Gradient bar */}
        <div className="relative max-w-xs">
          <div
            className="h-2.5 w-full rounded-full"
            style={{ background: `linear-gradient(to right, ${RED}, ${AMBER}, ${GREEN})` }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full border-2 border-white shadow ring-1 ring-black/10"
            style={{ left: `${thumbPct}%`, backgroundColor: color }}
          />
          <div className="flex justify-between mt-1.5 text-[10px] text-[#9CA3AF]">
            <span>0</span><span>5</span><span>10</span>
          </div>
        </div>

        {/* Plain language label */}
        <p className="mt-2 text-xs font-semibold" style={{ color }}>
          {score >= 7 ? 'Good — high match quality' : score >= 5 ? 'Fair — room for improvement' : 'Poor — significant data gaps'}
        </p>
      </div>

      {/* Right: big number */}
      <div className="text-right shrink-0">
        <p className="text-5xl font-bold tabular-nums" style={{ color }}>{score.toFixed(1)}</p>
        <p className="text-xs text-[#9CA3AF] mt-0.5">/ 10</p>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

interface CAPIMonitoringDashboardProps {
  provider: CAPIProviderConfig;
  onBack: () => void;
}

type Window = 7 | 30;

export function CAPIMonitoringDashboard({ provider, onBack }: CAPIMonitoringDashboardProps) {
  const { dashboard, dashboardLoading, setDashboard, setDashboardLoading } = useCAPIStore();
  const [window, setWindow] = useState<Window>(7);

  function load(days: Window) {
    setDashboardLoading(true);
    capiApi
      .getDashboard(provider.id, days)
      .then(setDashboard)
      .catch(() => {})
      .finally(() => setDashboardLoading(false));
  }

  useEffect(() => { load(window); }, [provider.id, window]); // eslint-disable-line react-hooks/exhaustive-deps

  const statusStyle = STATUS_STYLES[provider.status] ?? { bg: '#F3F4F6', color: '#6B7280' };

  const deliveryColor =
    !dashboard ? '#1A1A1A' :
    dashboard.delivery_rate >= 0.95 ? GREEN :
    dashboard.delivery_rate >= 0.80 ? AMBER : RED;

  const deliveryBg =
    !dashboard ? '#fff' :
    dashboard.delivery_rate >= 0.95 ? '#F0FDF4' :
    dashboard.delivery_rate >= 0.80 ? '#FFFBEB' : '#FEF2F2';

  return (
    <div className="space-y-6">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="text-sm text-[#9CA3AF] hover:text-[#1A1A1A] transition-colors flex items-center gap-1"
          >
            ← Back
          </button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-page-title">{PROVIDER_LABELS[provider.provider] ?? provider.provider}</h2>
              <span
                className="text-xs px-2 py-0.5 rounded font-semibold"
                style={{ backgroundColor: statusStyle.bg, color: statusStyle.color }}
              >
                {provider.status}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* 7d / 30d toggle */}
          <div className="flex items-center rounded-lg border border-[#E5E7EB] p-0.5">
            {([7, 30] as Window[]).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setWindow(d)}
                className="px-3 py-1 text-xs font-medium rounded transition-colors"
                style={
                  window === d
                    ? { backgroundColor: NAVY, color: '#fff' }
                    : { color: '#9CA3AF' }
                }
              >
                {d}d
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => load(window)}
            disabled={dashboardLoading}
            className="flex items-center gap-1.5 text-xs text-[#9CA3AF] hover:text-[#1A1A1A] transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${dashboardLoading ? 'animate-spin' : ''}`} strokeWidth={1.5} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Loading ──────────────────────────────────────────────────────── */}
      {dashboardLoading && !dashboard && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} variant="metric" />)}
          </div>
          <SkeletonCard variant="chart" />
        </div>
      )}

      {dashboard && (
        <>
          {/* ── Stat cells ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatCell label="Total Events" value={fmt(dashboard.total_events)} />
            <StatCell
              label="Delivered"
              value={fmt(dashboard.delivered)}
              valueColor={dashboard.delivered > 0 ? GREEN : '#1A1A1A'}
              bg={dashboard.delivered > 0 ? '#F0FDF4' : '#fff'}
              borderColor={dashboard.delivered > 0 ? `${GREEN}30` : '#E5E7EB'}
            />
            <StatCell
              label="Failed"
              value={fmt(dashboard.failed)}
              valueColor={dashboard.failed > 0 ? RED : '#1A1A1A'}
              bg={dashboard.failed > 0 ? '#FEF2F2' : '#fff'}
              borderColor={dashboard.failed > 0 ? `${RED}30` : '#E5E7EB'}
            />
            <StatCell
              label="Delivery Rate"
              value={pct(dashboard.delivery_rate)}
              valueColor={deliveryColor}
              bg={deliveryBg}
              borderColor={`${deliveryColor}30`}
            />
            <StatCell
              label="Avg Latency"
              value={
                dashboard.avg_latency_ms < 1000
                  ? `${Math.round(dashboard.avg_latency_ms)}ms`
                  : `${(dashboard.avg_latency_ms / 1000).toFixed(1)}s`
              }
              sub={
                dashboard.blocked_by_consent > 0
                  ? `${fmt(dashboard.blocked_by_consent)} consent-blocked`
                  : undefined
              }
            />
          </div>

          {/* ── EMQ score — Meta only ──────────────────────────────────── */}
          {dashboard.avg_emq !== null && (
            <div className="space-y-3">
              <EMQCard score={dashboard.avg_emq} />
              <MetricGuidance result={emqGuidance(dashboard.avg_emq)} collapsible />
            </div>
          )}

          {/* ── Delivery guidance ──────────────────────────────────────── */}
          <MetricGuidance result={capiDeliveryGuidance(dashboard.delivery_rate)} collapsible />

          {/* ── Daily delivery area chart ──────────────────────────────── */}
          <div className="rounded-lg border border-[#E5E7EB] bg-white px-5 py-4">
            <p className="text-section-header mb-4">Daily Delivery</p>
            <DeliveryAreaChart
              byDay={window === 7 ? dashboard.by_day.slice(-7) : dashboard.by_day}
            />
          </div>

          {/* ── Event breakdown ────────────────────────────────────────── */}
          <div className="rounded-lg border border-[#E5E7EB] bg-white px-5 py-4">
            <p className="text-section-header mb-4">Event Breakdown</p>
            <EventBreakdownTable byEvent={dashboard.by_event} />
          </div>

          {/* ── Error log ──────────────────────────────────────────────── */}
          <ErrorLog
            errors={dashboard.errors ?? []}
            isLoading={dashboardLoading}
          />
        </>
      )}
    </div>
  );
}
