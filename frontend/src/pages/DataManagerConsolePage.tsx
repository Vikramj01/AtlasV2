import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Download, Search, AlertTriangle } from 'lucide-react';
import { PlanGate } from '@/components/common/PlanGate';
import { dataManagerApi } from '@/lib/api/dataManagerApi';
import type { ClientDMARow } from '@/lib/api/dataManagerApi';
import { supabase } from '@/lib/supabase';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeDate(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function formatNumber(n: number): string {
  if (n === 0) return '—';
  return n.toLocaleString();
}

// ── Sparkline ─────────────────────────────────────────────────────────────────

function Sparkline({ points }: { points: Array<{ matchRate: number | null }> }) {
  const values = points.map((p) => p.matchRate).filter((v): v is number => v !== null);
  if (values.length < 2)
    return <span className="text-xs text-muted-foreground">—</span>;

  const W = 60,
    H = 24,
    PAD = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const pts = values
    .map((v, i) => {
      const x = PAD + (i / (values.length - 1)) * (W - PAD * 2);
      const y = PAD + (1 - (v - min) / range) * (H - PAD * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const last = values[values.length - 1];
  const colour = last >= 70 ? '#059669' : last >= 40 ? '#D97706' : '#DC2626';

  return (
    <svg width={W} height={H} className="inline-block">
      <polyline
        points={pts}
        fill="none"
        stroke={colour}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── Metric colour helpers ─────────────────────────────────────────────────────

function matchRateColour(rate: number | null): string {
  if (rate === null) return 'text-muted-foreground';
  if (rate >= 70) return 'text-emerald-600 font-semibold';
  if (rate >= 40) return 'text-amber-600 font-semibold';
  return 'text-red-600 font-semibold';
}

function successRateColour(rate: number | null): string {
  if (rate === null) return 'text-muted-foreground';
  if (rate >= 90) return 'text-emerald-600 font-semibold';
  if (rate >= 70) return 'text-amber-600 font-semibold';
  return 'text-red-600 font-semibold';
}

// ── Action chip labels ────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  gtg_not_deployed: 'Deploy GTG',
  dma_not_connected: 'Reconnect DMA',
  low_match_rate: 'Low match rate',
};

// ── Skeleton row ──────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="border-b border-[#F3F4F6] animate-pulse">
      {Array.from({ length: 9 }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 rounded bg-[#F3F4F6]" style={{ width: i === 0 ? 140 : 80 }} />
        </td>
      ))}
    </tr>
  );
}

// ── Sort types ────────────────────────────────────────────────────────────────

type SortBy = 'name' | 'match_rate' | 'members' | 'needs_action';

// ── Page ──────────────────────────────────────────────────────────────────────

function DataManagerConsoleInner() {
  const { orgId } = useParams<{ orgId: string }>();
  const [clients, setClients] = useState<ClientDMARow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('needs_action');
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    dataManagerApi
      .getClients(orgId)
      .then(({ clients: rows }) => setClients(rows))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load clients'))
      .finally(() => setLoading(false));
  }, [orgId]);

  function sorted(rows: ClientDMARow[]): ClientDMARow[] {
    return [...rows].sort((a, b) => {
      if (sortBy === 'name') return a.client_name.localeCompare(b.client_name);
      if (sortBy === 'match_rate') return (b.avg_match_rate ?? -1) - (a.avg_match_rate ?? -1);
      if (sortBy === 'members') return b.total_members_30d - a.total_members_30d;
      if (sortBy === 'needs_action') return b.needs_action.length - a.needs_action.length;
      return 0;
    });
  }

  const filtered = sorted(
    clients.filter(
      (c) =>
        c.client_name.toLowerCase().includes(search.toLowerCase()) ||
        c.website_url.toLowerCase().includes(search.toLowerCase()),
    ),
  );

  const totalClients = clients.length;
  const avgMatchRate =
    clients.length > 0
      ? clients.reduce((sum, c) => sum + (c.avg_match_rate ?? 0), 0) / clients.length
      : null;
  const clientsNeedingAction = clients.filter((c) => c.needs_action.length > 0).length;

  async function handleExport() {
    if (!orgId) return;
    setExporting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) return;
      const res = await fetch(`${API_BASE}/api/data-manager/${orgId}/export/csv`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dma-console-${orgId}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Data Manager Console</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Agency-wide DMA health across all clients
        </p>
      </div>

      {/* Summary chips */}
      <div className="flex flex-wrap gap-4">
        <div className="rounded-lg border border-[#E5E7EB] bg-white px-4 py-3 shadow-sm">
          <p className="text-xs text-muted-foreground">Total clients</p>
          <p className="mt-0.5 text-2xl font-semibold text-foreground">{totalClients}</p>
        </div>
        <div className="rounded-lg border border-[#E5E7EB] bg-white px-4 py-3 shadow-sm">
          <p className="text-xs text-muted-foreground">Avg match rate</p>
          <p
            className={`mt-0.5 text-2xl font-semibold ${avgMatchRate !== null ? matchRateColour(avgMatchRate) : 'text-muted-foreground'}`}
          >
            {avgMatchRate !== null ? `${avgMatchRate.toFixed(1)}%` : '—'}
          </p>
        </div>
        <div className="rounded-lg border border-[#E5E7EB] bg-white px-4 py-3 shadow-sm">
          <p className="text-xs text-muted-foreground">Clients needing action</p>
          <p
            className={`mt-0.5 text-2xl font-semibold ${clientsNeedingAction > 0 ? 'text-amber-600' : 'text-emerald-600'}`}
          >
            {clientsNeedingAction}
          </p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search clients…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-[#E5E7EB] bg-white py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground whitespace-nowrap">Sort by:</label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            className="rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20"
          >
            <option value="needs_action">Needs action</option>
            <option value="match_rate">Match rate</option>
            <option value="members">Members (30d)</option>
            <option value="name">Name</option>
          </select>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting || loading}
          className="flex items-center gap-2 rounded-md bg-[#1B2A4A] px-4 py-2 text-sm font-medium text-white hover:bg-[#1B2A4A]/90 disabled:opacity-60 transition-opacity"
        >
          <Download className="h-4 w-4" />
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-[#E5E7EB] bg-white shadow-sm">
        <table className="min-w-full divide-y divide-[#F3F4F6] text-sm">
          <thead>
            <tr className="bg-[#F9FAFB]">
              {[
                { key: 'name' as SortBy, label: 'Client' },
                { key: null, label: 'GTG' },
                { key: 'match_rate' as SortBy, label: 'Match Rate' },
                { key: null, label: 'Upload Success' },
                { key: 'members' as SortBy, label: 'Members (30d)' },
                { key: null, label: 'Destinations' },
                { key: null, label: 'Last Activity' },
                { key: null, label: 'Trend' },
                { key: 'needs_action' as SortBy, label: 'Actions Needed' },
              ].map(({ key, label }) => (
                <th
                  key={label}
                  className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground ${key ? 'cursor-pointer select-none hover:text-foreground' : ''}`}
                  onClick={key ? () => setSortBy(key) : undefined}
                >
                  {label}
                  {key && sortBy === key && (
                    <span className="ml-1 text-[#1B2A4A]">▾</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F3F4F6]">
            {loading
              ? Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
              : filtered.length === 0
                ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-4 py-12 text-center text-sm text-muted-foreground"
                    >
                      {clients.length === 0
                        ? 'No clients found for this organisation.'
                        : 'No clients match your search.'}
                    </td>
                  </tr>
                )
                : filtered.map((client) => (
                  <tr
                    key={client.client_id}
                    className="hover:bg-[#F9FAFB] transition-colors"
                  >
                    {/* Client name */}
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{client.client_name}</p>
                      <p className="text-xs text-muted-foreground truncate max-w-[180px]">
                        {client.website_url}
                      </p>
                    </td>

                    {/* GTG status */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      {client.gtg_active ? (
                        <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                          Not deployed
                        </span>
                      )}
                    </td>

                    {/* Match rate */}
                    <td className={`px-4 py-3 whitespace-nowrap ${matchRateColour(client.avg_match_rate)}`}>
                      {client.avg_match_rate !== null
                        ? `${client.avg_match_rate.toFixed(1)}%`
                        : '—'}
                    </td>

                    {/* Upload success */}
                    <td className={`px-4 py-3 whitespace-nowrap ${successRateColour(client.upload_success_rate)}`}>
                      {client.upload_success_rate !== null
                        ? `${client.upload_success_rate.toFixed(1)}%`
                        : '—'}
                    </td>

                    {/* Members 30d */}
                    <td className="px-4 py-3 whitespace-nowrap text-foreground">
                      {formatNumber(client.total_members_30d)}
                    </td>

                    {/* Destinations */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center justify-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          client.destination_count > 0
                            ? 'bg-[#1B2A4A] text-white'
                            : 'bg-[#F3F4F6] text-muted-foreground'
                        }`}
                      >
                        {client.destination_count}
                      </span>
                    </td>

                    {/* Last activity */}
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-muted-foreground">
                      {relativeDate(client.last_dma_activity)}
                    </td>

                    {/* Trend sparkline */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Sparkline points={client.trend_points} />
                    </td>

                    {/* Actions needed */}
                    <td className="px-4 py-3">
                      {client.needs_action.length === 0 ? (
                        <span className="text-xs text-emerald-600">All good</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {client.needs_action.map((flag) => (
                            <span
                              key={flag}
                              className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700"
                            >
                              <AlertTriangle className="h-3 w-3" />
                              {ACTION_LABELS[flag] ?? flag}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function DataManagerConsolePage() {
  return (
    <PlanGate minPlan="agency" featureName="Data Manager Console">
      <DataManagerConsoleInner />
    </PlanGate>
  );
}
