import { useState } from 'react';
import type { UsagePortfolioRow } from '@/types/usage';

interface Props {
  rows: UsagePortfolioRow[];
  month: string;           // YYYY-MM
  onMonthChange: (m: string) => void;
  onSelectOrg: (orgId: string) => void;
  selectedOrgId: string | null;
  loading: boolean;
}

const PLAN_COLORS: Record<string, string> = {
  free:   'bg-gray-100 text-gray-600',
  pro:    'bg-blue-100 text-blue-700',
  agency: 'bg-purple-100 text-purple-700',
};

const STATUS_DOT: Record<string, string> = {
  green: 'bg-green-500',
  amber: 'bg-amber-400',
  red:   'bg-red-500',
  na:    'bg-gray-300',
};

const STATUS_LABEL: Record<string, string> = {
  green: 'OK',
  amber: 'Watch',
  red:   'Alert',
  na:    'N/A',
};

function fmt(n: number) {
  return n.toFixed(4).replace(/\.?0+$/, '') || '0';
}

function formatTier(t: string): string {
  return t.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function UsagePortfolioTable({
  rows,
  month,
  onMonthChange,
  onSelectOrg,
  selectedOrgId,
  loading,
}: Props) {
  const [sortCol, setSortCol] = useState<'cost' | 'margin' | 'scans' | 'ai'>('cost');

  const sorted = [...rows].sort((a, b) => {
    if (sortCol === 'cost')   return b.total_variable_cost_usd - a.total_variable_cost_usd;
    if (sortCol === 'margin') return (b.gross_margin_pct ?? 100) - (a.gross_margin_pct ?? 100);
    if (sortCol === 'scans')  return b.total_page_scans - a.total_page_scans;
    return b.total_ai_calls - a.total_ai_calls;
  });

  // Summary totals
  const totalCost = rows.reduce((s, r) => s + r.total_variable_cost_usd, 0);
  const totalMRR  = rows.reduce((s, r) => s + r.mrr_usd, 0);
  const alertCount = rows.filter((r) => r.margin_status === 'red').length;

  function SortButton({ col, label }: { col: typeof sortCol; label: string }) {
    return (
      <button
        onClick={() => setSortCol(col)}
        className={`transition-colors ${sortCol === col ? 'text-foreground font-semibold' : 'text-muted-foreground hover:text-foreground'}`}
      >
        {label}{sortCol === col ? ' ↓' : ''}
      </button>
    );
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span>Total cost MTD: <span className="font-semibold text-foreground">${fmt(totalCost)}</span></span>
          <span>Total MRR: <span className="font-semibold text-foreground">${totalMRR.toLocaleString()}</span></span>
          {alertCount > 0 && (
            <span className="text-red-600 font-medium">{alertCount} margin alert{alertCount > 1 ? 's' : ''}</span>
          )}
        </div>
        <input
          type="month"
          value={month}
          onChange={(e) => onMonthChange(e.target.value)}
          className="rounded-lg border px-2 py-1 text-sm text-foreground bg-white"
        />
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-[#F9FAFB] text-left text-xs uppercase tracking-wide">
              <th className="px-4 py-3 font-semibold text-muted-foreground">Organisation</th>
              <th className="px-4 py-3 font-semibold text-muted-foreground">Plan</th>
              <th className="px-4 py-3 font-semibold text-muted-foreground">Tier</th>
              <th className="px-4 py-3 font-semibold text-muted-foreground text-right">MRR</th>
              <th className="px-4 py-3 text-right">
                <SortButton col="cost" label="Total cost" />
              </th>
              <th className="px-4 py-3 text-right text-muted-foreground font-semibold">Scan $</th>
              <th className="px-4 py-3 text-right text-muted-foreground font-semibold">AI $</th>
              <th className="px-4 py-3 text-right">
                <SortButton col="margin" label="Margin %" />
              </th>
              <th className="px-4 py-3 text-right">
                <SortButton col="scans" label="Scans" />
              </th>
              <th className="px-4 py-3 text-right">
                <SortButton col="ai" label="AI calls" />
              </th>
              <th className="px-4 py-3 text-center font-semibold text-muted-foreground">Violations</th>
              <th className="px-4 py-3 text-center font-semibold text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading && (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 12 }).map((__, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-3 rounded bg-gray-100 animate-pulse" style={{ width: j === 0 ? '120px' : '60px' }} />
                    </td>
                  ))}
                </tr>
              ))
            )}
            {!loading && sorted.map((row) => (
              <tr
                key={row.org_id}
                onClick={() => onSelectOrg(row.org_id)}
                className={`cursor-pointer hover:bg-gray-50 transition-colors ${selectedOrgId === row.org_id ? 'bg-blue-50' : ''}`}
              >
                <td className="px-4 py-3 font-medium text-foreground">{row.org_name}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PLAN_COLORS[row.plan] ?? 'bg-gray-100 text-gray-600'}`}>
                    {row.plan}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {row.subscription_tier
                    ? <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">{formatTier(row.subscription_tier)}</span>
                    : <span className="text-xs text-muted-foreground">—</span>
                  }
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                  {row.mrr_usd > 0 ? `$${row.mrr_usd.toLocaleString()}` : '—'}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-medium">
                  ${fmt(row.total_variable_cost_usd)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                  ${fmt(row.scan_cost_usd)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                  ${fmt(row.ai_cost_usd)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {row.gross_margin_pct !== null ? `${row.gross_margin_pct}%` : '—'}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                  {row.total_page_scans.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                  {row.total_ai_calls.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-center">
                  {(row.open_violations_count ?? 0) > 0
                    ? <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${(row.open_violations_count ?? 0) >= 3 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{row.open_violations_count}</span>
                    : <span className="text-xs text-muted-foreground">—</span>
                  }
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${STATUS_DOT[row.margin_status]}`} />
                    <span className="text-xs text-muted-foreground">{STATUS_LABEL[row.margin_status]}</span>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={12} className="px-4 py-10 text-center text-muted-foreground">
                  No usage data for this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
