/**
 * HealthDashboardPage — Data Health Dashboard (Phase 2)
 * 5-zone layout: score ring → key metrics → alerts → trend chart → quick actions
 */

import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, ExternalLink, ShieldCheck, Zap, BarChart3 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { healthApi } from '@/lib/api/healthApi';
import type { HealthDashboardResponse, HealthSnapshot } from '@/types/health';
import { OverallScoreRing } from '@/components/health/OverallScoreRing';
import { KeyMetricsRow } from '@/components/health/KeyMetricsRow';
import { ActiveAlertsFeed } from '@/components/health/ActiveAlertsFeed';
import { HealthHistoryChart } from '@/components/health/HealthHistoryChart';

type LoadState = 'loading' | 'loaded' | 'error' | 'empty';

export default function HealthDashboardPage() {
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState<HealthDashboardResponse | null>(null);
  const [history, setHistory] = useState<HealthSnapshot[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [computing, setComputing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const [dash, hist] = await Promise.all([
        healthApi.getDashboard(),
        healthApi.getHistory(30),
      ]);
      setDashboard(dash);
      setHistory(hist.snapshots);
      setLoadState(dash.score ? 'loaded' : 'empty');
      setLastRefresh(new Date());
    } catch {
      setLoadState('error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCompute() {
    setComputing(true);
    try {
      await healthApi.triggerCompute();
      // Poll for update after a short delay
      setTimeout(async () => {
        await load();
        setComputing(false);
      }, 4000);
    } catch {
      setComputing(false);
    }
  }

  // ── Loading skeleton ────────────────────────────────────────────────────────
  if (loadState === 'loading') {
    return (
      <div className="p-6 space-y-6 animate-pulse">
        <div className="h-8 bg-muted rounded w-64" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="h-48 bg-muted rounded-xl" />
          <div className="lg:col-span-2 h-48 bg-muted rounded-xl" />
        </div>
        <div className="h-32 bg-muted rounded-xl" />
        <div className="h-40 bg-muted rounded-xl" />
      </div>
    );
  }

  // ── Error state ─────────────────────────────────────────────────────────────
  if (loadState === 'error') {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <p className="text-sm text-muted-foreground">Failed to load health dashboard.</p>
        <button
          type="button"
          onClick={load}
          className="text-sm px-4 py-2 rounded-lg border hover:bg-muted transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  // ── Empty state (no score computed yet) ─────────────────────────────────────
  if (loadState === 'empty' || !dashboard?.score) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[50vh] gap-4 text-center">
        <BarChart3 className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-base font-semibold">No health data yet</p>
        <p className="text-sm text-muted-foreground max-w-sm">
          Run your first audit or set up CAPI to see your Data Health Score.
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleCompute}
            disabled={computing}
            className="text-sm px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60 transition-colors"
          >
            {computing ? 'Computing…' : 'Compute Score Now'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/audit/new')}
            className="text-sm px-4 py-2 rounded-lg border hover:bg-muted transition-colors"
          >
            Run Audit
          </button>
        </div>
      </div>
    );
  }

  const { score, alerts } = dashboard;

  return (
    <div className="p-6 space-y-6 max-w-5xl">

      {/* ── Page header ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Data Health</h1>
          {lastRefresh && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Last refreshed {lastRefresh.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={handleCompute}
          disabled={computing}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border hover:bg-muted disabled:opacity-60 transition-colors"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${computing ? 'animate-spin' : ''}`} />
          {computing ? 'Computing…' : 'Refresh'}
        </button>
      </div>

      {/* ── Zone 1 + 2: Score ring + Key metrics ───────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[auto_1fr]">
        {/* Score ring */}
        <div className="flex items-center justify-center rounded-xl border bg-card px-8 py-6">
          <OverallScoreRing score={score.overall_score} computedAt={score.computed_at} />
        </div>

        {/* Key metrics */}
        <div className="flex flex-col justify-center gap-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Sub-scores</p>
          <KeyMetricsRow score={score} />
        </div>
      </div>

      {/* ── Zone 3: Active alerts ───────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold mb-3">
          Active Alerts
          {alerts.length > 0 && (
            <span className="ml-2 inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-100 text-red-700 text-[10px] font-bold">
              {alerts.length}
            </span>
          )}
        </h2>
        <ActiveAlertsFeed alerts={alerts} />
      </section>

      {/* ── Zone 4: Trend chart ─────────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold mb-3">30-Day Trend</h2>
        <div className="rounded-xl border bg-card px-5 py-4">
          <HealthHistoryChart snapshots={history} />
        </div>
      </section>

      {/* ── Zone 5: Quick actions ───────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold mb-3">Quick Actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <QuickActionCard
            icon={<BarChart3 className="h-4 w-4" />}
            title="Run Audit"
            description="Check your latest conversion tracking against 26 rules"
            onClick={() => navigate('/audit/new')}
          />
          <QuickActionCard
            icon={<Zap className="h-4 w-4" />}
            title="Set Up CAPI"
            description="Connect server-side event delivery to improve your score"
            onClick={() => navigate('/settings')}
          />
          <QuickActionCard
            icon={<ShieldCheck className="h-4 w-4" />}
            title="Configure Consent"
            description="Activate Consent Hub to hit 100% consent coverage"
            onClick={() => navigate('/settings')}
            trailingIcon={<ExternalLink className="h-3 w-3 opacity-40" />}
          />
        </div>
      </section>
    </div>
  );
}

// ── Quick action card ──────────────────────────────────────────────────────────

interface QuickActionCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  trailingIcon?: React.ReactNode;
}

function QuickActionCard({ icon, title, description, onClick, trailingIcon }: QuickActionCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left rounded-xl border bg-card px-4 py-4 hover:bg-muted/50 transition-colors group"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="p-1.5 rounded-lg bg-primary/10 text-primary shrink-0">
          {icon}
        </div>
        {trailingIcon && <span className="mt-1">{trailingIcon}</span>}
      </div>
      <p className="text-sm font-semibold mt-3">{title}</p>
      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
    </button>
  );
}
