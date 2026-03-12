import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AuditHistoryTable } from '@/components/audit/AuditHistoryTable';
import type { AuditHistoryItem } from '@/components/audit/AuditHistoryTable';
import { auditApi } from '@/lib/api/auditApi';

export function DashboardPage() {
  const [audits, setAudits] = useState<AuditHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    auditApi.list()
      .then(setAudits)
      .catch(() => setAudits([]))
      .finally(() => setLoading(false));
  }, []);

  async function handleDelete(id: string) {
    await auditApi.delete(id);
    setAudits((prev) => prev.filter((a) => a.id !== id));
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-8">
      <Card className="border-brand-200 bg-brand-50">
        <CardContent className="flex items-center justify-between p-6">
          <div>
            <h2 className="text-lg font-semibold">Audit your conversion tracking</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Define your funnel, select platforms, and Atlas will validate every signal.
            </p>
          </div>
          <Button asChild className="ml-6 flex-shrink-0 bg-brand-600 hover:bg-brand-700">
            <Link to="/journey/new">New Audit</Link>
          </Button>
        </CardContent>
      </Card>

      <section>
        <h2 className="mb-3 text-base font-semibold">Previous Audits</h2>
        <AuditHistoryTable audits={audits} loading={loading} onDelete={handleDelete} />
      </section>
    </div>
  );
}
