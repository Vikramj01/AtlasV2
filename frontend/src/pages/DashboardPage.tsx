import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AuditHistoryTable } from '@/components/audit/AuditHistoryTable';
import type { AuditHistoryItem } from '@/components/audit/AuditHistoryTable';
import { ScheduleList } from '@/components/audit/ScheduleList';
import { ScheduleModal } from '@/components/audit/ScheduleModal';
import { auditApi } from '@/lib/api/auditApi';
import { scheduleApi } from '@/lib/api/scheduleApi';
import type { Schedule } from '@/types/schedule';

export function DashboardPage() {
  const [audits, setAudits]         = useState<AuditHistoryItem[]>([]);
  const [schedules, setSchedules]   = useState<Schedule[]>([]);
  const [loadingAudits, setLoadingAudits]     = useState(true);
  const [loadingSchedules, setLoadingSchedules] = useState(true);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [activeTab, setActiveTab]   = useState<'history' | 'schedules'>('history');

  useEffect(() => {
    auditApi.list()
      .then(setAudits)
      .catch(() => setAudits([]))
      .finally(() => setLoadingAudits(false));
  }, []);

  const loadSchedules = useCallback(() => {
    setLoadingSchedules(true);
    scheduleApi.list()
      .then(setSchedules)
      .catch(() => setSchedules([]))
      .finally(() => setLoadingSchedules(false));
  }, []);

  useEffect(() => { loadSchedules(); }, [loadSchedules]);

  async function handleDelete(id: string) {
    await auditApi.delete(id);
    setAudits((prev) => prev.filter((a) => a.id !== id));
  }

  function handleScheduleCreated() {
    setShowScheduleModal(false);
    loadSchedules();
  }

  const activeScheduleCount = schedules.filter((s) => s.is_active).length;

  const pageHeading = useMemo(() => {
    if (loadingAudits || audits.length === 0) return null;
    const domains = [...new Set(audits.map((a) => {
      try { return new URL(a.website_url).hostname.replace(/^www\./, ''); }
      catch { return a.website_url; }
    }))];
    if (domains.length === 1) return domains[0];
    return 'All Sites';
  }, [audits, loadingAudits]);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-8">
      {/* Page heading */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {pageHeading ?? 'Audit History'}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {pageHeading
            ? `Conversion tracking audits for ${pageHeading}`
            : 'Run an audit to start tracking your conversion signal health.'}
        </p>
      </div>

      {/* CTA card */}
      <Card className="border-[#1B2A4A]/20 bg-[#EEF1F7]">
        <CardContent className="flex items-center justify-between p-6">
          <div>
            <h2 className="text-lg font-semibold">Audit your conversion tracking</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Define your funnel, select platforms, and Atlas will validate every signal.
            </p>
          </div>
          <Button asChild className="ml-6 flex-shrink-0 bg-[#1B2A4A] hover:bg-[#1B2A4A]">
            <Link to="/journey/new">New Audit</Link>
          </Button>
        </CardContent>
      </Card>

      {/* Tab navigation */}
      <div className="flex items-center justify-between">
        <div className="flex border-b w-full">
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'history'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Audit History
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('schedules')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === 'schedules'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Scheduled Audits
            {activeScheduleCount > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-semibold">
                {activeScheduleCount} active
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Tab content */}
      {activeTab === 'history' && (
        <section>
          <AuditHistoryTable audits={audits} loading={loadingAudits} onDelete={handleDelete} />
        </section>
      )}

      {activeTab === 'schedules' && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">
                Scheduled audits run automatically and alert you when tracking degrades.
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => setShowScheduleModal(true)}
              className="flex items-center gap-1.5"
            >
              <Plus className="h-4 w-4" />
              New schedule
            </Button>
          </div>

          {loadingSchedules ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div key={i} className="rounded-xl border p-4 animate-pulse">
                  <div className="h-4 bg-muted rounded w-48 mb-2" />
                  <div className="h-3 bg-muted rounded w-64" />
                </div>
              ))}
            </div>
          ) : (
            <ScheduleList schedules={schedules} onRefresh={loadSchedules} />
          )}
        </section>
      )}

      {/* Create schedule modal */}
      {showScheduleModal && (
        <ScheduleModal
          onClose={() => setShowScheduleModal(false)}
          onCreated={handleScheduleCreated}
        />
      )}
    </div>
  );
}
