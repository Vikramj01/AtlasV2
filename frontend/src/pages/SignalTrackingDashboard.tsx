import { useEffect, useCallback, useRef, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { RefreshCw, Download } from 'lucide-react';
import { signalEventsApi } from '@/lib/api/signalEventsApi';
import { SignalFilterBar } from '@/components/signals/SignalFilterBar';
import { SignalFlowTable } from '@/components/signals/SignalFlowTable';
import { SignalAggregateCards } from '@/components/signals/SignalAggregateCards';
import type { SignalEventRow, SignalFilters, SignalAggregates } from '@/types/signal-tracking';

// ── Filter ↔ URL helpers ──────────────────────────────────────────────────────

function rangeToFromTo(range: SignalFilters['range']): { from: string; to: string } {
  const to  = new Date();
  const from = new Date(to);
  if      (range === '1h')  from.setHours(from.getHours() - 1);
  else if (range === '24h') from.setDate(from.getDate() - 1);
  else if (range === '7d')  from.setDate(from.getDate() - 7);
  else if (range === '30d') from.setDate(from.getDate() - 30);
  return { from: from.toISOString(), to: to.toISOString() };
}

function filtersFromParams(params: URLSearchParams): SignalFilters {
  const range = (params.get('range') ?? '24h') as SignalFilters['range'];
  const { from: defaultFrom, to: defaultTo } = rangeToFromTo(range === 'custom' ? '24h' : range);
  return {
    range,
    from:          params.get('from') ?? defaultFrom,
    to:            params.get('to')   ?? defaultTo,
    destinations:  params.get('dest')   ? params.get('dest')!.split(',').filter(Boolean)   : [],
    event_names:   params.get('events') ? params.get('events')!.split(',').filter(Boolean)  : [],
    statuses:      params.get('status') ? params.get('status')!.split(',').filter(Boolean)  : [],
    dedup_statuses:params.get('dedup')  ? params.get('dedup')!.split(',').filter(Boolean)   : [],
  };
}

function filtersToParams(f: SignalFilters): URLSearchParams {
  const p = new URLSearchParams();
  p.set('range', f.range);
  if (f.range === 'custom') { p.set('from', f.from); p.set('to', f.to); }
  if (f.destinations.length)   p.set('dest',   f.destinations.join(','));
  if (f.event_names.length)    p.set('events', f.event_names.join(','));
  if (f.statuses.length)       p.set('status', f.statuses.join(','));
  if (f.dedup_statuses.length) p.set('dedup',  f.dedup_statuses.join(','));
  return p;
}

// ── Component ─────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 30_000;

export function SignalTrackingDashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters]           = useState<SignalFilters>(() => filtersFromParams(searchParams));
  const [rows, setRows]                 = useState<SignalEventRow[]>([]);
  const [nextCursor, setNextCursor]     = useState<string | null>(null);
  const [isLoading, setIsLoading]       = useState(false);
  const [isAppending, setIsAppending]   = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [aggregates, setAggregates]     = useState<SignalAggregates | null>(null);
  const [aggLoading, setAggLoading]     = useState(false);
  const [activeCard, setActiveCard]     = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Collect unique event names from loaded rows for the event filter dropdown
  const eventNameOptions = [...new Set(rows.map((r) => r.event_name))].sort();

  // ── Core fetch ──────────────────────────────────────────────────────────────

  const fetchPage = useCallback(async (currentFilters: SignalFilters, cursor?: string) => {
    const isFirstPage = !cursor;
    if (isFirstPage) setIsLoading(true); else setIsAppending(true);
    setError(null);

    try {
      const listPromise = signalEventsApi.list({
        from:           currentFilters.from,
        to:             currentFilters.to,
        destinations:   currentFilters.destinations.length ? currentFilters.destinations : undefined,
        event_names:    currentFilters.event_names.length   ? currentFilters.event_names  : undefined,
        statuses:       currentFilters.statuses.length      ? currentFilters.statuses     : undefined,
        dedup_statuses: currentFilters.dedup_statuses.length? currentFilters.dedup_statuses : undefined,
        cursor,
      });

      // Only fetch aggregates on first page load
      const aggPromise = isFirstPage
        ? (setAggLoading(true),
           signalEventsApi.aggregates(
             currentFilters.from,
             currentFilters.to,
             currentFilters.destinations.length ? currentFilters.destinations : undefined,
           ).catch(() => null))
        : Promise.resolve(null);

      const [listRes, aggRes] = await Promise.all([listPromise, aggPromise]);

      if (isFirstPage) {
        setRows(listRes.data);
      } else {
        setRows((prev) => [...prev, ...listRes.data]);
      }
      setNextCursor(listRes.next_cursor);
      if (aggRes) setAggregates(aggRes.data);
      setLastRefreshed(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load signals');
    } finally {
      setIsLoading(false);
      setIsAppending(false);
      setAggLoading(false);
    }
  }, []);

  // ── Filter change ────────────────────────────────────────────────────────────

  function applyFilter(partial: Partial<SignalFilters>) {
    setFilters((prev) => {
      let next = { ...prev, ...partial };

      // When a preset is chosen, recompute from/to
      if (partial.range && partial.range !== 'custom') {
        const { from, to } = rangeToFromTo(partial.range);
        next = { ...next, from, to };
      }

      setSearchParams(filtersToParams(next), { replace: true });
      return next;
    });
  }

  function handleCardClick(card: string, filterPatch: Partial<SignalFilters>) {
    const next = activeCard === card ? null : card;
    setActiveCard(next);
    applyFilter(next === null
      ? { dedup_statuses: [] }
      : filterPatch);
  }

  // Re-fetch whenever filters change (reset pagination)
  useEffect(() => {
    fetchPage(filters);
  }, [filters, fetchPage]);

  // ── Polling ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    function startPoll() {
      pollRef.current = setInterval(() => {
        if (!document.hidden) fetchPage(filters);
      }, POLL_INTERVAL_MS);
    }
    function stopPoll() {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }

    startPoll();
    function handleVisibility() { document.hidden ? stopPoll() : startPoll(); }
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      stopPoll();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [filters, fetchPage]);

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col min-h-0">
      {/* Page header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E7EB]">
        <div>
          <h1 className="text-lg font-semibold text-[#1A1A1A]">Signal Tracking</h1>
          <p className="text-xs text-[#6B7280] mt-0.5">Real-time view of outbound conversion signals</p>
        </div>
        <div className="flex items-center gap-3">
          {lastRefreshed && (
            <span className="text-xs text-[#9CA3AF]">
              Updated {lastRefreshed.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          <Link
            to={`/signal-tracking/export?from=${encodeURIComponent(filters.from)}&to=${encodeURIComponent(filters.to)}`}
            className="flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-medium text-[#374151] hover:border-[#9CA3AF] transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Link>
          <button
            onClick={() => fetchPage(filters)}
            disabled={isLoading}
            className="flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-medium text-[#374151] hover:border-[#9CA3AF] disabled:opacity-50 transition-colors"
            aria-label="Refresh signals"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Aggregate cards */}
      <SignalAggregateCards
        aggregates={aggregates}
        isLoading={aggLoading}
        activeCard={activeCard}
        onCardClick={handleCardClick}
      />

      {/* Filter bar */}
      <SignalFilterBar
        filters={filters}
        eventNameOptions={eventNameOptions}
        onChange={applyFilter}
      />

      {/* Error state */}
      {error && (
        <div className="mx-6 mt-4 rounded-md border border-[#FEE2E2] bg-[#FEF2F2] px-4 py-3">
          <p className="text-sm text-[#DC2626]">{error}</p>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <SignalFlowTable
          rows={rows}
          isLoading={isLoading || isAppending}
          hasMore={nextCursor !== null}
          p95LatencyMs={aggregates?.p95_latency_ms ?? null}
          onLoadMore={() => { if (nextCursor) fetchPage(filters, nextCursor); }}
        />
      </div>
    </div>
  );
}
