import { useEffect, useState } from 'react';
import { auditApi } from '@/lib/api/auditApi';
import { useAuditStore } from '@/store/auditStore';
import type { ReportJSON } from '@/types/audit';

export function useReport(auditId: string | undefined) {
  const setReport = useAuditStore((s) => s.setReport);
  const storedReport = useAuditStore((s) => s.report);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auditId || storedReport?.audit_id === auditId) return;

    setLoading(true);
    setError(null);

    auditApi
      .getReport(auditId)
      .then((r: ReportJSON) => {
        setReport(r);
      })
      .catch((err: Error) => {
        setError(err.message);
      })
      .finally(() => setLoading(false));
  }, [auditId, storedReport?.audit_id, setReport]);

  return {
    report: storedReport?.audit_id === auditId ? storedReport : null,
    loading,
    error,
  };
}
