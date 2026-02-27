import { RunAuditForm } from '@/components/audit/RunAuditForm';
import { AuditHistoryTable } from '@/components/audit/AuditHistoryTable';
import { useAuditHistory } from '@/hooks/useAuditHistory';

export function DashboardPage() {
  const { audits, loading } = useAuditHistory();

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-8">
      {/* Run new audit */}
      <RunAuditForm />

      {/* Previous audits */}
      <section>
        <h2 className="mb-3 text-base font-semibold text-gray-900">Previous Audits</h2>
        <AuditHistoryTable audits={audits} loading={loading} />
      </section>
    </div>
  );
}
