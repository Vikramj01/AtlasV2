import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { publicAuditApi } from '@/lib/api/publicAuditApi';
import type { PublicAuditRun } from '@/types/publicAudit';
import { AuditReportCard } from '@/components/publicAudit/AuditReportCard';

export function PublicAuditResultsPage() {
  const { token }               = useParams<{ token: string }>();
  const navigate                = useNavigate();
  const [run, setRun]           = useState<PublicAuditRun | null>(null);
  const [loading, setLoading]   = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [pending, setPending]   = useState(false);
  const pollRef                 = { current: null as ReturnType<typeof setInterval> | null };

  useEffect(() => {
    if (!token) { setNotFound(true); setLoading(false); return; }

    async function load() {
      try {
        const res = await publicAuditApi.pollAudit(token!);
        const auditRun = res.data;

        if (auditRun.status === 'done') {
          setRun(auditRun);
          setLoading(false);
        } else if (auditRun.status === 'failed') {
          setNotFound(true);
          setLoading(false);
        } else {
          // Still scanning — poll until done
          setPending(true);
          setLoading(false);
          pollRef.current = setInterval(async () => {
            try {
              const inner = await publicAuditApi.pollAudit(token!);
              if (inner.data.status === 'done') {
                clearInterval(pollRef.current!);
                setRun(inner.data);
                setPending(false);
              } else if (inner.data.status === 'failed') {
                clearInterval(pollRef.current!);
                setNotFound(true);
                setPending(false);
              }
            } catch { /* keep polling */ }
          }, 3000);
        }
      } catch {
        setNotFound(true);
        setLoading(false);
      }
    }

    load();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-4 border-indigo-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center px-4">
        <div className="max-w-sm text-center space-y-4">
          <p className="text-2xl font-semibold">Report not found</p>
          <p className="text-gray-400 text-sm">
            This report has expired or does not exist. Reports are available for 24 hours after generation.
          </p>
          <Button onClick={() => navigate('/audit')} className="bg-indigo-600 hover:bg-indigo-500">
            Run a new audit
          </Button>
        </div>
      </div>
    );
  }

  if (pending) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center px-4">
        <div className="max-w-sm text-center space-y-4">
          <div className="w-12 h-12 mx-auto rounded-full border-4 border-indigo-500 border-t-transparent animate-spin" />
          <p className="text-gray-300">Audit in progress…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <span className="text-lg font-semibold tracking-tight">Atlas</span>
        <div className="flex gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/login')} className="text-gray-400 hover:text-white">
            Sign in
          </Button>
          <Button size="sm" onClick={() => navigate('/login')} className="bg-indigo-600 hover:bg-indigo-500">
            Get full plan
          </Button>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center px-4 pb-12">
        {run && <AuditReportCard run={run} token={token!} onRunAnother={() => navigate('/audit')} />}
      </main>

      <footer className="border-t border-gray-800 px-6 py-4 text-center text-xs text-gray-600">
        Reports expire after 24 hours. &copy; Atlas — atlas.vimi.digital
      </footer>
    </div>
  );
}
