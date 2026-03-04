import { Link } from 'react-router-dom';
import { AuditHistoryTable } from '@/components/audit/AuditHistoryTable';
import { useAuditHistory } from '@/hooks/useAuditHistory';

export function DashboardPage() {
  const { audits, loading } = useAuditHistory();

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-8">
      {/* CTA to launch Journey Builder */}
      <div className="rounded-xl border border-brand-200 bg-brand-50 p-6 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Audit your conversion tracking</h2>
          <p className="mt-1 text-sm text-gray-600">
            Define your funnel, select platforms, and Atlas will validate every signal.
          </p>
        </div>
        <Link
          to="/journey/new"
          className="ml-6 flex-shrink-0 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 transition-colors"
        >
          New Audit
        </Link>
      </div>

      {/* Previous audits */}
      <section>
        <h2 className="mb-3 text-base font-semibold text-gray-900">Previous Audits</h2>
        <AuditHistoryTable audits={audits} loading={loading} />
      </section>
    </div>
  );
}
