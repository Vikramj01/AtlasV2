// InsightsFeedPanel — AIR narrated anomaly feed for the Health Dashboard.
// Loads the 50 most recent insights from /api/insights (pro plan gated).
// Unread insights are highlighted; dismissing removes them from the local list.

import { useEffect, useState } from 'react';
import { TrendingDown, TrendingUp, X, Sparkles, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SeverityCard } from '@/components/common/SeverityCard';
import type { SeverityLevel } from '@/components/common/SeverityCard';
import { insightsApi } from '@/lib/api/insightsApi';
import type { AirInsight, AirSeverity, AirSource } from '@/types/air';

// ── Style helpers ─────────────────────────────────────────────────────────────

const SEVERITY_CARD: Record<AirSeverity, SeverityLevel> = {
  high:   'critical',
  medium: 'warning',
  low:    'info',
};

const SOURCE_LABEL: Record<AirSource, string> = {
  google_ads: 'Google Ads',
  meta_ads:   'Meta Ads',
  ga4:        'GA4',
};

const METRIC_LABEL: Record<string, string> = {
  spend:           'Spend',
  impressions:     'Impressions',
  clicks:          'Clicks',
  conversions:     'Conversions',
  ctr:             'CTR',
  cpa:             'CPA',
  sessions:        'Sessions',
  key_events:      'Key Events',
  engaged_sessions:'Engaged Sessions',
  bounce_rate:     'Bounce Rate',
  engagement_rate: 'Engagement Rate',
};

function fmtMetric(key: string): string {
  return METRIC_LABEL[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function fmtPct(pct: number): string {
  const abs = Math.abs(pct).toFixed(1);
  return pct < 0 ? `−${abs}%` : `+${abs}%`;
}

// ── Skeleton loader ───────────────────────────────────────────────────────────

function InsightSkeleton() {
  return (
    <div className="animate-pulse rounded-lg border border-[#E5E7EB] border-l-[3px] border-l-[#E5E7EB] bg-white px-4 py-3 space-y-2">
      <div className="flex items-center gap-2">
        <div className="h-3 w-16 rounded bg-[#E5E7EB]" />
        <div className="h-3 w-24 rounded bg-[#E5E7EB]" />
      </div>
      <div className="h-3.5 w-full rounded bg-[#E5E7EB]" />
      <div className="h-3.5 w-4/5 rounded bg-[#E5E7EB]" />
      <div className="h-2.5 w-20 rounded bg-[#E5E7EB] mt-1" />
    </div>
  );
}

// ── Single insight card ───────────────────────────────────────────────────────

interface InsightCardProps {
  insight: AirInsight;
  onDismiss: (id: string) => void;
  onRead: (id: string) => void;
}

function InsightCard({ insight, onDismiss, onRead }: InsightCardProps) {
  const anomaly = insight.air_anomalies;
  const severity: SeverityLevel = anomaly ? SEVERITY_CARD[anomaly.severity] : 'neutral';
  const isUnread = insight.status === 'unread';

  function handleClick() {
    if (isUnread) onRead(insight.id);
  }

  const deviationPct = anomaly?.deviation_pct ?? 0;
  const isDown = deviationPct < 0;

  return (
    <SeverityCard
      severity={severity}
      compact
      className={cn('cursor-pointer hover:brightness-[0.98] transition-all', isUnread && 'ring-1 ring-inset ring-[#1B2A4A]/10')}
      onClick={handleClick}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          {/* Header: source + metric + date */}
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            {anomaly && (
              <span className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wide">
                {SOURCE_LABEL[anomaly.source]}
              </span>
            )}
            {anomaly && (
              <span className="text-[11px] text-[#9CA3AF]">·</span>
            )}
            {anomaly && (
              <span className="text-[11px] font-medium text-[#6B7280]">
                {fmtMetric(anomaly.metric_name)}
                {anomaly.dimension && <span className="text-[#9CA3AF]"> / {anomaly.dimension}</span>}
              </span>
            )}
            {isUnread && (
              <span className="ml-auto shrink-0 h-1.5 w-1.5 rounded-full bg-[#1B2A4A]" title="Unread" />
            )}
          </div>

          {/* Deviation badge */}
          {anomaly && (
            <div className="flex items-center gap-1.5 mb-2">
              {isDown
                ? <TrendingDown className="h-3.5 w-3.5 text-[#DC2626] shrink-0" strokeWidth={2} />
                : <TrendingUp   className="h-3.5 w-3.5 text-[#059669] shrink-0" strokeWidth={2} />
              }
              <span className={cn('text-xs font-semibold', isDown ? 'text-[#DC2626]' : 'text-[#059669]')}>
                {fmtPct(anomaly.deviation_pct)}
              </span>
              <span className="text-[11px] text-[#9CA3AF]">vs 14-day avg on {fmtDate(anomaly.detected_date)}</span>
            </div>
          )}

          {/* Narrative */}
          <p className="text-sm text-[#374151] leading-relaxed">{insight.narrative}</p>

          {/* Footer */}
          <p className="text-[10px] text-[#9CA3AF] mt-2">
            {fmtDate(insight.created_at)} · AIR
          </p>
        </div>

        {/* Dismiss */}
        <button
          type="button"
          aria-label="Dismiss insight"
          onClick={(e) => { (e as { stopPropagation: () => void }).stopPropagation(); onDismiss(insight.id); }}
          className="shrink-0 p-1 rounded hover:bg-black/5 transition-colors mt-0.5"
        >
          <X className="h-3.5 w-3.5 text-[#9CA3AF]" strokeWidth={1.5} />
        </button>
      </div>
    </SeverityCard>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function InsightsFeedPanel() {
  const [insights, setInsights]   = useState<AirInsight[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [triggerMsg, setTriggerMsg] = useState<string | null>(null);

  useEffect(() => {
    insightsApi.getInsights()
      .then(({ data }) => {
        setInsights((data ?? []).filter((i) => i.status !== 'dismissed'));
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, []);

  function handleTrigger() {
    setTriggering(true);
    setTriggerMsg(null);
    insightsApi.trigger()
      .then(({ data }) => {
        setTriggerMsg(data.status === 'queued' ? 'Analysis queued — check back shortly.' : 'Analysis already running.');
      })
      .catch(() => {
        setTriggerMsg('Failed to queue analysis.');
      })
      .finally(() => setTriggering(false));
  }

  function handleDismiss(id: string) {
    setInsights((prev) => prev.filter((i) => i.id !== id));
    insightsApi.updateStatus(id, 'dismissed').catch(() => {});
  }

  function handleRead(id: string) {
    setInsights((prev) =>
      prev.map((i) => (i.id === id ? { ...i, status: 'read' as const } : i)),
    );
    insightsApi.updateStatus(id, 'read').catch(() => {});
  }

  const unreadCount = insights.filter((i) => i.status === 'unread').length;

  return (
    <div>
      {/* Section header */}
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="h-4 w-4 text-[#1B2A4A]" strokeWidth={1.5} />
        <h2 className="text-section-header">AI Insights</h2>
        {unreadCount > 0 && (
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#1B2A4A] text-white text-[10px] font-bold">
            {unreadCount}
          </span>
        )}
        <button
          type="button"
          onClick={handleTrigger}
          disabled={triggering}
          className="ml-auto flex items-center gap-1 text-xs text-[#6B7280] hover:text-[#1B2A4A] disabled:opacity-50 transition-colors"
          title="Run analysis now"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${triggering ? 'animate-spin' : ''}`} strokeWidth={1.5} />
          {triggering ? 'Running…' : 'Run now'}
        </button>
      </div>
      {triggerMsg && (
        <p className="text-xs text-[#6B7280] mb-3">{triggerMsg}</p>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex flex-col gap-2">
          <InsightSkeleton />
          <InsightSkeleton />
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <p className="text-sm text-[#6B7280] py-4">Failed to load insights.</p>
      )}

      {/* Empty */}
      {!loading && !error && insights.length === 0 && (
        <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-5 py-6 text-center">
          <Sparkles className="h-6 w-6 text-[#9CA3AF] mx-auto mb-2" strokeWidth={1.5} />
          <p className="text-sm font-medium text-[#6B7280]">No insights yet</p>
          <p className="text-xs text-[#9CA3AF] mt-1">AIR will surface anomalies in your ad platforms overnight.</p>
        </div>
      )}

      {/* Feed */}
      {!loading && !error && insights.length > 0 && (
        <div className="flex flex-col gap-2">
          {insights.map((insight) => (
            <InsightCard
              key={insight.id}
              insight={insight}
              onDismiss={handleDismiss}
              onRead={handleRead}
            />
          ))}
        </div>
      )}
    </div>
  );
}
