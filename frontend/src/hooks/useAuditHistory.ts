import { useEffect, useState } from 'react';
import { auditApi } from '@/lib/api/auditApi';
import type { AuditHistoryItem } from '@/components/audit/AuditHistoryTable';

export function useAuditHistory() {
  const [audits, setAudits] = useState<AuditHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    auditApi
      .list()
      .then(setAudits)
      .catch(() => setAudits([]))
      .finally(() => setLoading(false));
  }, []);

  return { audits, loading };
}
