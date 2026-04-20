/**
 * HealthDashboardPage — Signal Health (Screen 2).
 *
 * Design spec (Screen 2):
 *   "Score Circle: 180px diameter, Navy stroke."
 *   "Guidance: Plain-language interpretation is critical below the score."
 *
 * 5-zone layout:
 *   1. Score ring + key metrics row
 *   2. Active alerts feed
 *   3. 30-day trend chart
 *   4. Readiness score checklist
 *   5. Quick actions
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { RefreshCw, BarChart3, Zap, ShieldCheck, ChevronDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { healthApi } from '@/lib/api/healthApi';
import type { HealthDashboardResponse, HealthSnapshot, SiteOption } from '@/types/health';
import { OverallScoreRing } from '@/components/health/OverallScoreRing';
import { KeyMetricsRow } from '@/components/health/KeyMetricsRow';
import { ActiveAlertsFeed } from '@/components/health/ActiveAlertsFeed';
import { HealthHistoryChart } from '@/components/health/HealthHistoryChart';
import { ReadinessScore } from '@/components/health/ReadinessScore';
import { EmptyState } from '@/components/common/EmptyState';
import { PageSkeleton } from '@/components/common/SkeletonCard';
import { Button } from '@/components/ui/button';

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

  // ── Loading — Sprint 0 PageSkeleton ──────────────────────────────────────
  if (loadState === 'loading') {
    return <PageSkeleton />;
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (loadState === 'error') {
    return (
      <div className="px-6 py-16 flex flex-col items-center gap-3 text-center">
        <p className="text-sm text-[#6B7280]">Failed to load health dashboard.</p>
        <Button variant="secondary" size="sm" onClick={() => load(selectedSite ?? undefined)}>
          Retry
        </Button>
      </div>
    );
  }

  // ── Empty — common EmptyState ─────────────────────────────────────────────
  if (loadState === 'empty' || !dashboard?.score) {
    return (
      <div className="px-6 py-8">
        <EmptyState
          icon="chart"
          title="No health data yet"
          description="Run your first audit to see your Signal Health score, active alerts, and 30-day trend."
          action={
            <Button onClick={() => navigate('/journey/new')} className="gap-2">
              <BarChart3 className="h-4 w-4" strokeWidth={1.5} />
              Run your first audit
            </Button>
          }
        />
      </div>
    );
  }

  const { score, alerts } = dashboard;

  return (
    <div className="px-6 py-8 max-w-5xl space-y-8">

      {/* ── Page header ───────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-page-title">Signal Health</h1>

            {/* Site selector */}
            {sites.length > 1 && (
              <div className="relative" ref={dropdownRef}>
                <button
                  type="button"
                  onClick={() => setSiteDropdownOpen((o) => !o)}
                  className="flex items-center gap-1 text-sm font-medium px-2.5 py-1 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] hover:bg-white transition-colors max-w-[240px]"
                >
                  <span className="truncate text-[#6B7280]">
                    {selectedSite ? formatDomain(selectedSite) : 'All Sites'}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#9CA3AF]" strokeWidth={1.5} />
                </button>
                {siteDropdownOpen && (
                  <div className="absolute left-0 top-full mt-1 z-50 min-w-[200px] rounded-lg border border-[#E5E7EB] bg-white shadow-md py-1">
                    <button
                      type="button"
                      onClick={() => handleSiteChange(null)}
                      className={`w-full text-left px-3 py-1.5 text-sm hover:bg-[#F9FAFB] transition-colors ${selectedSite === null ? 'font-semibold text-[#1B2A4A]' : 'text-[#6B7280]'}`}
                    >
                      All Sites
                    </button>
                    {sites.map((s) => (
                      <button
                        key={s.website_url}
                        type="button"
                        onClick={() => handleSiteChange(s.website_url)}
                        className={`w-full text-left px-3 py-1.5 text-sm hover:bg-[#F9FAFB] transition-colors truncate ${selectedSite === s.website_url ? 'font-semibold text-[#1B2A4A]' : 'text-[#6B7280]'}`}
                      >
                        {formatDomain(s.website_url)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {sites.length === 1 && (
              <span className="text-sm px-2.5 py-1 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] text-[#6B7280] max-w-[240px] truncate">
                {formatDomain(sites[0].website_url)}
              </span>
            )}
            {sites.length === 0 && score.website_url && (
              <span className="text-sm px-2.5 py-1 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] text-[#6B7280] max-w-[240px] truncate">
                {formatDomain(score.website_url)}
              </span>
            )}
          </div>

          {lastRefresh && (
            <p className="text-body text-[#6B7280] mt-1">
              Last updated {lastRefresh.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={handleCompute}
          disabled={computing}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-[#E5E7EB] hover:bg-[#F9FAFB] disabled:opacity-60 transition-colors shrink-0"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${computing ? 'animate-spin' : ''}`} strokeWidth={1.5} />
          {computing ? 'Computing…' : 'Refresh'}
        </button>
      </div>

      {/* ── Zone 1: Score ring + key metrics ──────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[auto_1fr]">
        {/* Score ring — centered in its own card */}
        <div className="flex items-center justify-center rounded-lg border border-[#E5E7EB] bg-white px-10 py-8">
          <OverallScoreRing score={score.overall_score} computedAt={score.computed_at} />
        </div>

        {/* Key metrics sub-scores */}
        <div className="flex flex-col justify-center gap-4">
          <p className="text-caption-upper">Sub-scores</p>
          <KeyMetricsRow score={score} />
        </div>
      </div>

      {/* ── Zone 2: Active alerts ──────────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-section-header">Active Alerts</h2>
          {alerts.length > 0 && (
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#FEF2F2] text-[#DC2626] text-[10px] font-bold border border-[#DC2626]/20">
              {alerts.length}
            </span>
          )}
        </div>
        <ActiveAlertsFeed alerts={alerts} />
      </section>

      {/* ── Zone 3: 30-day trend chart ─────────────────────────────────────── */}
      <section>
        <h2 className="text-section-header mb-3">30-Day Trend</h2>
        <div className="rounded-lg border border-[#E5E7EB] bg-white px-5 py-4">
          <HealthHistoryChart snapshots={history} />
        </div>
      </section>

      {/* ── Zone 4: Setup completeness ────────────────────────────────────── */}
      <section>
        <h2 className="text-section-header mb-3">Setup completeness</h2>
        <ReadinessScore />
      </section>

      {/* ── Zone 5: Quick actions ──────────────────────────────────────────── */}
      <section>
        <h2 className="text-section-header mb-3">Quick Actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <QuickActionCard
            Icon={BarChart3}
            title="Run Audit"
            description="Check your latest conversion tracking setup"
            onClick={() => navigate('/audit/new')}
          />
          <QuickActionCard
            Icon={Zap}
            title="Set Up CAPI"
            description="Connect server-side event delivery to improve your score"
            onClick={() => navigate('/integrations/capi')}
          />
          <QuickActionCard
            Icon={ShieldCheck}
            title="Configure Consent"
            description="Activate Consent Hub to hit 100% consent coverage"
            onClick={() => navigate('/consent')}
          />
        </div>
      </section>
    </div>
  );
}

// ── Quick action card ──────────────────────────────────────────────────────────

interface QuickActionCardProps {
  Icon: React.ElementType;
  title: string;
  description: string;
  onClick: () => void;
}

function QuickActionCard({ Icon, title, description, onClick }: QuickActionCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left rounded-lg border border-[#E5E7EB] bg-white px-4 py-4 hover:bg-[#F9FAFB] hover:border-[#1B2A4A]/20 transition-colors group"
    >
      {/* Icon in navy bg square */}
      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[#EEF1F7] mb-3">
        <Icon className="h-4.5 w-4.5 text-[#1B2A4A]" strokeWidth={1.5} />
      </div>
      <p className="text-section-header text-[#1A1A1A]">{title}</p>
      <p className="text-xs text-[#6B7280] mt-1 leading-relaxed">{description}</p>
    </button>
  );
}
