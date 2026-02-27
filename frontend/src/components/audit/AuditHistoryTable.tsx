import { Link } from 'react-router-dom';
import { HealthBadge } from '@/components/common/HealthBadge';
import type { AuditStatus } from '@/types/audit';

export interface AuditHistoryItem {
  id: string;
  website_url: string;
  created_at: string;
  status: AuditStatus;
  signal_health?: number;
  attribution_risk?: string;
}

const STATUS_BADGE: Record<AuditStatus, { label: string; cls: string }> = {
  queued:    { label: 'Queued',     cls: 'bg-gray-100 text-gray-600' },
  running:   { label: 'Running',    cls: 'bg-blue-100 text-blue-700' },
  completed: { label: 'Complete',   cls: 'bg-green-100 text-green-700' },
  failed:    { label: 'Failed',     cls: 'bg-red-100 text-red-700' },
};

interface Props {
  audits: AuditHistoryItem[];
  loading: boolean;
}

export function AuditHistoryTable({ audits, loading }: Props) {
  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-gray-400">
        Loading audit history…
      </div>
    );
  }

  if (audits.length === 0) {
    return (
      <div className="flex h-32 flex-col items-center justify-center gap-1 text-sm text-gray-400">
        <span>No audits yet.</span>
        <span>Run your first audit above to get started.</span>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="min-w-full divide-y divide-gray-100">
        <thead className="bg-gray-50">
          <tr>
            {['Website', 'Date', 'Signal Health', 'Attribution Risk', 'Status', ''].map((h) => (
              <th
                key={h}
                className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {audits.map((audit) => {
            const s = STATUS_BADGE[audit.status];
            const domain = (() => {
              try { return new URL(audit.website_url).hostname; }
              catch { return audit.website_url; }
            })();

            return (
              <tr key={audit.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 text-sm font-medium text-gray-900 max-w-xs truncate">{domain}</td>
                <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                  {new Date(audit.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  {audit.signal_health != null ? (
                    <HealthBadge score={audit.signal_health} />
                  ) : (
                    <span className="text-sm text-gray-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {audit.attribution_risk ? (
                    <span className="text-sm text-gray-700">{audit.attribution_risk}</span>
                  ) : (
                    <span className="text-sm text-gray-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.cls}`}>
                    {s.label}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  {audit.status === 'completed' && (
                    <Link
                      to={`/report/${audit.id}`}
                      className="text-sm font-medium text-brand-600 hover:text-brand-700"
                    >
                      View →
                    </Link>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
