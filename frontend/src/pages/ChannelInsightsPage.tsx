/**
 * ChannelInsightsPage — Channel Signal Behaviour
 *
 * Three tabs:
 *   Overview    — per-channel comparison table (sessions, conversion rate, SCS, health)
 *   Journeys    — side-by-side funnel flow
 *   Diagnostics — prioritised signal gap and journey divergence list
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { RefreshCw, GitBranch, ChevronDown, Code2, BarChart2, Zap } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { channelApi } from '@/lib/api/channelApi';
import { ChannelOverviewTable } from '@/components/channels/ChannelOverviewTable';
import { JourneyFlowComparison } from '@/components/channels/JourneyFlowComparison';
import { DiagnosticsFeed } from '@/components/channels/DiagnosticsFeed';
import { EmptyState } from '@/components/common/EmptyState';
import { PageSkeleton } from '@/components/common/SkeletonCard';
import type {
  ChannelOverview,
  ChannelJourneyMap,
  ChannelDiagnostic,
} from '@/types/channel';

type LoadState = 'loading' | 'loaded' | 'error' | 'empty';

const NAVY = '#1B2A4A';

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

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loadState === 'loading') {
    return (
      <div className="px-6 py-8 max-w-5xl">
        <PageSkeleton />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (loadState === 'error') {
    return (
      <div className="px-6 py-8 max-w-5xl flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <EmptyState
          icon="signals"
          title="Failed to load channel insights"
          description="Something went wrong loading your channel data. Please try again."
          action={
            <Button variant="secondary" onClick={() => load(selectedSite ?? undefined, days)}>
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="px-6 py-8 max-w-5xl space-y-5">

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-page-title">Channel Insights</h1>

            {/* Site selector */}
            {sites.length > 1 && (
              <div className="relative" ref={dropdownRef}>
                <button
                  type="button"
                  onClick={() => setSiteDropdownOpen((o) => !o)}
                  className="flex items-center gap-1 text-sm font-medium px-2.5 py-1 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] hover:bg-[#F3F4F6] transition-colors max-w-[240px]"
                >
                  <span className="truncate">
                    {selectedSite ? formatDomain(selectedSite) : 'All Sites'}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#9CA3AF]" />
                </button>
                {siteDropdownOpen && (
                  <div className="absolute left-0 top-full mt-1 z-50 min-w-[200px] rounded-lg border border-[#E5E7EB] bg-white shadow-md py-1">
                    <button
                      type="button"
                      onClick={() => { setSelectedSite(null); setSiteDropdownOpen(false); }}
                      className={`w-full text-left px-3 py-1.5 text-sm hover:bg-[#F9FAFB] transition-colors ${selectedSite === null ? 'font-semibold text-[#1B2A4A]' : 'text-[#6B7280]'}`}
                    >
                      All Sites
                    </button>
                    {sites.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => { setSelectedSite(s); setSiteDropdownOpen(false); }}
                        className={`w-full text-left px-3 py-1.5 text-sm hover:bg-[#F9FAFB] transition-colors truncate ${selectedSite === s ? 'font-semibold text-[#1B2A4A]' : 'text-[#6B7280]'}`}
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
              className="text-sm font-medium px-2.5 py-1 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] hover:bg-[#F3F4F6] transition-colors cursor-pointer text-[#1A1A1A]"
            >
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </div>
          {lastRefresh && (
            <p className="text-xs text-[#9CA3AF] mt-0.5">
              Last refreshed {lastRefresh.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={handleCompute}
          disabled={computing}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[#E5E7EB] hover:bg-[#F9FAFB] disabled:opacity-60 transition-colors shrink-0 text-[#6B7280]"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${computing ? 'animate-spin' : ''}`} />
          {computing ? 'Computing…' : 'Refresh'}
        </button>
      </div>

      {/* ── Empty state ───────────────────────────────────────────────────── */}
      {loadState === 'empty' ? (
        <div className="rounded-lg border border-dashed border-[#E5E7EB] py-14 px-6">
          <div className="flex flex-col items-center text-center gap-3 mb-10">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#EEF1F7]">
              <GitBranch className="h-6 w-6" style={{ color: NAVY }} strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-section-header">No channel data yet</p>
              <p className="mt-1 text-body text-[#6B7280] max-w-md mx-auto">
                Channel Insights shows how each traffic source performs in terms of signal quality,
                journey completion, and conversions. Add the Atlas tracking snippet to get started.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
            {[
              { Icon: Code2, step: 'Step 1', text: <>Run a <strong>New Audit</strong> or open <strong>Set Up Tracking</strong> to generate your Atlas snippet.</> },
              { Icon: Zap,   step: 'Step 2', text: <>Paste the snippet into your <code className="text-xs bg-[#F3F4F6] px-1 py-0.5 rounded">&lt;head&gt;</code> or deploy via GTM. Sessions are captured automatically.</> },
              { Icon: BarChart2, step: 'Step 3', text: <>Once traffic flows, click <strong>Refresh</strong> above to compute channel journey maps.</> },
            ].map(({ Icon, step, text }) => (
              <div key={step} className="flex flex-col gap-2 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#1A1A1A]">
                  <Icon className="h-4 w-4 text-[#9CA3AF] shrink-0" strokeWidth={1.5} />
                  {step}
                </div>
                <p className="text-sm text-[#6B7280]">{text}</p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* ── Tabs ─────────────────────────────────────────────────────────── */
        <Tabs defaultValue="overview">
          {/* Navy underline tab bar */}
          <TabsList className="h-auto rounded-none border-b border-[#E5E7EB] bg-transparent p-0 gap-0 w-full justify-start">
            <TabsTrigger
              value="overview"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-[#1B2A4A] data-[state=active]:text-[#1B2A4A] data-[state=active]:bg-transparent data-[state=active]:shadow-none text-[#6B7280] hover:text-[#1A1A1A] px-4 py-2.5 text-sm font-medium bg-transparent h-auto transition-colors"
            >
              Overview
              {overviews.length > 0 && (
                <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#EEF1F7] text-[#1B2A4A]">
                  {overviews.length}
                </span>
              )}
            </TabsTrigger>

            <TabsTrigger
              value="journeys"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-[#1B2A4A] data-[state=active]:text-[#1B2A4A] data-[state=active]:bg-transparent data-[state=active]:shadow-none text-[#6B7280] hover:text-[#1A1A1A] px-4 py-2.5 text-sm font-medium bg-transparent h-auto transition-colors"
            >
              Journeys
            </TabsTrigger>

            <TabsTrigger
              value="diagnostics"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-[#1B2A4A] data-[state=active]:text-[#1B2A4A] data-[state=active]:bg-transparent data-[state=active]:shadow-none text-[#6B7280] hover:text-[#1A1A1A] px-4 py-2.5 text-sm font-medium bg-transparent h-auto transition-colors"
            >
              Diagnostics
              {diagnostics.length > 0 && (
                <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#FEF2F2] text-[#DC2626]">
                  {diagnostics.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4">
            <ChannelOverviewTable overviews={overviews} />
          </TabsContent>

          <TabsContent value="journeys" className="mt-4">
            <JourneyFlowComparison journeys={journeys} />
          </TabsContent>

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
