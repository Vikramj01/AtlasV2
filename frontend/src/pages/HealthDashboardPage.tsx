/**
 * HealthDashboardPage — Data Health Dashboard (Phase 2)
 * 5-zone layout: score ring → key metrics → alerts → trend chart → quick actions
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { RefreshCw, ExternalLink, ShieldCheck, Zap, BarChart3, ChevronDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { healthApi } from '@/lib/api/healthApi';
import type { HealthDashboardResponse, HealthSnapshot, SiteOption } from '@/types/health';
import { OverallScoreRing } from '@/components/health/OverallScoreRing';
import { KeyMetricsRow } from '@/components/health/KeyMetricsRow';
import { ActiveAlertsFeed } from '@/components/health/ActiveAlertsFeed';
import { HealthHistoryChart } from '@/components/health/HealthHistoryChart';
import { ReadinessScore } from '@/components/health/ReadinessScore';

type LoadState = 'loading' | 'loaded' | 'error' | 'empty';

export default function HealthDashboardPage() {
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState<HealthDashboardResponse | null>(null);
  const [history, setHistory] = useState<HealthSnapshot[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [computing, setComputing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [selectedSite, setSelectedSite] = useState<string | null>(null);
  const [siteDropdownOpen, setSiteDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setSiteDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const load = useCallback(async (site?: string) => {
    try {
      const [dash, hist] = await Promise.all([
        healthApi.getDashboard(),
        healthApi.getHistory(30, site ?? undefined),
      ]);
      const resolvedSites = dash.sites ?? [];
      setDashboard(dash);
      setHistory(hist.snapshots);
      setSites(resolvedSites);
      // Only show loaded state if the user has actual completed audits.
      // A stale health_scores row with no audits should show the empty state.
      setLoadState((dash.score && resolvedSites.length > 0) ? 'loaded' : 'empty');
      setLastRefresh(new Date());
    } catch {
      setLoadState('error');
    }
  }, []);

  useEffect(() => { load(selectedSite ?? undefined); }, [load, selectedSite]);

  async function handleSiteChange(site: string | null) {
    setSelectedSite(site);
    setSiteDropdownOpen(false);
  }

  async function handleCompute() {
    setComputing(true);
    try {
      await healthApi.triggerCompute(selectedSite ?? undefined);
      // Poll for update after a short delay
      setTimeout(async () => {
        await load(selectedSite ?? undefined);
        setComputing(false);
      }, 4000);
    } catch {
      setComputing(false);
    }
  }

  function formatDomain(url: string): string {
    try { return new URL(url).hostname.replace(/^www\./, ''); }
    catch { return url; }
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
          onClick={() => load(selectedSite ?? undefined)}
          className="text-sm px-4 py-2 rounded-lg border hover:bg-muted transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  // ── Empty state (no completed audits yet) ───────────────────────────────────
  if (loadState === 'empty' || !dashboard?.score) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[50vh] gap-4 text-center">
        <BarChart3 className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-base font-semibold">No health data yet</p>
        <p className="text-sm text-muted-foreground max-w-sm">
          Run your first audit to see your Data Health Score, alerts, and 30-day trend.
        </p>
        <button
          type="button"
          onClick={() => navigate('/journey/new')}
          className="text-sm px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Run your first audit
        </button>
      </div>
    );
  }

  const { score, alerts } = dashboard;

  return (
    <div className="p-6 space-y-6 max-w-5xl">

      {/* ── Page header ────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-semibold tracking-tight">Data Health</h1>
            {/* Site selector — multi-site */}
            {sites.length > 1 && (
              <div className="relative" ref={dropdownRef}>
                <button
                  type="button"
                  onClick={() => setSiteDropdownOpen((o) => !o)}
                  className="flex items-center gap-1 text-sm font-medium px-2.5 py-1 rounded-lg border bg-muted/50 hover:bg-muted transition-colors max-w-[240px]"
                >
                  <span className="truncate">
                    {selectedSite ? formatDomain(selectedSite) : 'All Sites'}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </button>
                {siteDropdownOpen && (
                  <div className="absolute left-0 top-full mt-1 z-50 min-w-[200px] rounded-lg border bg-popover shadow-md py-1">
                    <button
                      type="button"
                      onClick={() => handleSiteChange(null)}
                      className={`w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors ${selectedSite === null ? 'font-semibold text-primary' : ''}`}
                    >
                      All Sites
                    </button>
                    {sites.map((s) => (
                      <button
                        key={s.website_url}
                        type="button"
                        onClick={() => handleSiteChange(s.website_url)}
                        className={`w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors truncate ${selectedSite === s.website_url ? 'font-semibold text-primary' : ''}`}
                      >
                        {formatDomain(s.website_url)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {/* Single-site label — static badge when only one site exists */}
            {sites.length === 1 && (
              <span className="text-sm font-medium px-2.5 py-1 rounded-lg border bg-muted/50 text-muted-foreground max-w-[240px] truncate">
                {formatDomain(sites[0].website_url)}
              </span>
            )}
            {/* Fallback: show URL from the score record if sites list is empty */}
            {sites.length === 0 && score.website_url && (
              <span className="text-sm font-medium px-2.5 py-1 rounded-lg border bg-muted/50 text-muted-foreground max-w-[240px] truncate">
                {formatDomain(score.website_url)}
              </span>
            )}
          </div>
          {lastRefresh && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Last refreshed {lastRefresh.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
              {(selectedSite ?? (sites.length === 0 ? score.website_url : null)) && (
                <span className="ml-1 text-muted-foreground/60">
                  · {formatDomain(selectedSite ?? score.website_url ?? '')}
                </span>
              )}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={handleCompute}
          disabled={computing}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border hover:bg-muted disabled:opacity-60 transition-colors shrink-0"
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

      {/* ── Zone 5: Readiness score ─────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold mb-3">First-Party Data Readiness</h2>
        <ReadinessScore />
      </section>

      {/* ── Zone 6: Quick actions ───────────────────────────────────────────── */}
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
