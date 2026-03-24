/**
 * ChannelInsightsPage — Channel Signal Behaviour
 *
 * Three tabs:
 *   Overview    — per-channel comparison table (sessions, conversion rate, SCS, health)
 *   Journeys    — side-by-side funnel flow (Landing → Engagement → Micro-Conv → Conversion)
 *   Diagnostics — prioritised signal gap, journey divergence, and engagement anomaly list
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { RefreshCw, GitBranch, ChevronDown } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { channelApi } from '@/lib/api/channelApi';
import { ChannelOverviewTable } from '@/components/channels/ChannelOverviewTable';
import { JourneyFlowComparison } from '@/components/channels/JourneyFlowComparison';
import { DiagnosticsFeed } from '@/components/channels/DiagnosticsFeed';
import type {
  ChannelOverview,
  ChannelJourneyMap,
  ChannelDiagnostic,
} from '@/types/channel';

type LoadState = 'loading' | 'loaded' | 'error' | 'empty';

export function ChannelInsightsPage() {
  const [overviews, setOverviews] = useState<ChannelOverview[]>([]);
  const [journeys, setJourneys] = useState<ChannelJourneyMap[]>([]);
  const [diagnostics, setDiagnostics] = useState<ChannelDiagnostic[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [computing, setComputing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [sites, setSites] = useState<string[]>([]);
  const [selectedSite, setSelectedSite] = useState<string | null>(null);
  const [siteDropdownOpen, setSiteDropdownOpen] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [days, setDays] = useState(30);
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

  const load = useCallback(async (site?: string, daysWindow = 30) => {
    setLoadState('loading');
    try {
      const [overviewRes, journeysRes, diagnosticsRes] = await Promise.all([
        channelApi.getOverview(site, daysWindow),
        channelApi.getJourneys(site, daysWindow),
        channelApi.getDiagnostics(site),
      ]);

      setOverviews(overviewRes.overviews);
      setJourneys(journeysRes.journeys);
      setDiagnostics(diagnosticsRes.diagnostics);
      setSites(overviewRes.sites);
      setLoadState(overviewRes.has_data ? 'loaded' : 'empty');
      setLastRefresh(new Date());
    } catch {
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    load(selectedSite ?? undefined, days);
  }, [load, selectedSite, days]);

  async function handleCompute() {
    setComputing(true);
    try {
      await channelApi.triggerCompute(selectedSite ?? undefined);
      setTimeout(async () => {
        await load(selectedSite ?? undefined, days);
        setComputing(false);
      }, 3000);
    } catch {
      setComputing(false);
    }
  }

  async function handleResolve(id: string) {
    setResolvingId(id);
    try {
      await channelApi.resolveDiagnostic(id);
      setDiagnostics((prev) => prev.filter((d) => d.id !== id));
    } finally {
      setResolvingId(null);
    }
  }

  function formatDomain(url: string): string {
    try { return new URL(url).hostname.replace(/^www\./, ''); }
    catch { return url; }
  }

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (loadState === 'loading') {
    return (
      <div className="p-6 space-y-4 animate-pulse max-w-5xl">
        <div className="h-8 bg-muted rounded w-48" />
        <div className="h-10 bg-muted rounded w-64" />
        <div className="h-64 bg-muted rounded-xl" />
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────────
  if (loadState === 'error') {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <p className="text-sm text-muted-foreground">Failed to load channel insights.</p>
        <button
          type="button"
          onClick={() => load(selectedSite ?? undefined, days)}
          className="text-sm px-4 py-2 rounded-lg border hover:bg-muted transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 max-w-5xl">

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-semibold tracking-tight">Channel Insights</h1>

            {/* Site selector */}
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
                      onClick={() => { setSelectedSite(null); setSiteDropdownOpen(false); }}
                      className={`w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors ${selectedSite === null ? 'font-semibold text-primary' : ''}`}
                    >
                      All Sites
                    </button>
                    {sites.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => { setSelectedSite(s); setSiteDropdownOpen(false); }}
                        className={`w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors truncate ${selectedSite === s ? 'font-semibold text-primary' : ''}`}
                      >
                        {formatDomain(s)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Date range selector */}
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="text-sm font-medium px-2.5 py-1 rounded-lg border bg-muted/50 hover:bg-muted transition-colors cursor-pointer"
            >
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </div>
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
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border hover:bg-muted disabled:opacity-60 transition-colors shrink-0"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${computing ? 'animate-spin' : ''}`} />
          {computing ? 'Computing…' : 'Refresh'}
        </button>
      </div>

      {/* ── Empty state ───────────────────────────────────────────────────── */}
      {loadState === 'empty' ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed py-16 text-center">
          <GitBranch className="h-10 w-10 text-muted-foreground/30" />
          <div>
            <p className="text-base font-semibold">No channel data yet</p>
            <p className="mt-1 text-sm text-muted-foreground max-w-sm mx-auto">
              Send session data via{' '}
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded">POST /api/channels/ingest</code>{' '}
              to start tracking channel signal behaviour.
            </p>
          </div>
        </div>
      ) : (
        /* ── Tabs ─────────────────────────────────────────────────────────── */
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">
              Overview
              {overviews.length > 0 && (
                <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                  {overviews.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="journeys">
              Journeys
            </TabsTrigger>
            <TabsTrigger value="diagnostics">
              Diagnostics
              {diagnostics.length > 0 && (
                <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">
                  {diagnostics.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="mt-4">
            <ChannelOverviewTable overviews={overviews} />
          </TabsContent>

          {/* Journeys Tab */}
          <TabsContent value="journeys" className="mt-4">
            <JourneyFlowComparison journeys={journeys} />
          </TabsContent>

          {/* Diagnostics Tab */}
          <TabsContent value="diagnostics" className="mt-4">
            <DiagnosticsFeed
              diagnostics={diagnostics}
              onResolve={handleResolve}
              resolvingId={resolvingId}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
