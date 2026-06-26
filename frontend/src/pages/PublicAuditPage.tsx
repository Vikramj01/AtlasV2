import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { publicAuditApi } from '@/lib/api/publicAuditApi';
import type { PublicAuditRun } from '@/types/publicAudit';
import { AuditReportCard } from '@/components/publicAudit/AuditReportCard';

type View = 'idle' | 'scanning' | 'results' | 'error';

const SCAN_STEPS = [
  'Detecting platform',
  'Loading page in browser',
  'Scanning tags & pixels',
  'Scoring results',
];

export function PublicAuditPage() {
  const navigate        = useNavigate();
  const [searchParams]  = useSearchParams();
  const [view, setView]             = useState<View>('idle');
  const [url, setUrl]               = useState(() => searchParams.get('url') ?? '');
  const [urlError, setUrlError]     = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [token, setToken]           = useState('');
  const [scanStep, setScanStep]     = useState(0);
  const [run, setRun]               = useState<PublicAuditRun | null>(null);
  const [errorMsg, setErrorMsg]     = useState('');
  const pollRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const stepRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef      = useRef<number>(0);
  const autoSubmitted = useRef(false);

  function clearTimers() {
    if (pollRef.current)  clearInterval(pollRef.current);
    if (stepRef.current)  clearInterval(stepRef.current);
  }

  useEffect(() => clearTimers, []);

  // Auto-submit when a URL is passed via query param (e.g. from LoginPage)
  useEffect(() => {
    const prefilledUrl = searchParams.get('url');
    if (prefilledUrl && !autoSubmitted.current) {
      autoSubmitted.current = true;
      const syntheticEvent = { preventDefault: () => {} } as React.FormEvent;
      handleSubmit(syntheticEvent);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function validateUrl(raw: string): string | null {
    try {
      const parsed = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'URL must use http or https';
      return null;
    } catch {
      return 'Please enter a valid website URL';
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const normalised = url.startsWith('http') ? url : `https://${url}`;
    const err = validateUrl(normalised);
    if (err) { setUrlError(err); return; }
    setUrlError('');
    setSubmitting(true);

    try {
      const res = await publicAuditApi.submitAudit(normalised);
      setToken(res.token);
      startRef.current = Date.now();
      setView('scanning');
      startPolling(res.token);
      startStepAnimation();
    } catch (ex) {
      setErrorMsg(ex instanceof Error ? ex.message : 'Something went wrong. Please try again.');
      setView('error');
    } finally {
      setSubmitting(false);
    }
  }

  function startPolling(t: string) {
    pollRef.current = setInterval(async () => {
      try {
        const res = await publicAuditApi.pollAudit(t);
        const auditRun = res.data;
        if (auditRun.status === 'done') {
          clearTimers();
          setRun(auditRun);
          setView('results');
          // Push shareable URL into browser history without triggering navigation
          navigate(`/audit/results/${t}`, { replace: true });
        } else if (auditRun.status === 'failed') {
          clearTimers();
          setErrorMsg(auditRun.error ?? 'Audit failed. Please try again.');
          setView('error');
        }
      } catch {
        // keep polling — transient network error
      }
    }, 3000);
  }

  function startStepAnimation() {
    let step = 0;
    stepRef.current = setInterval(() => {
      step = Math.min(step + 1, SCAN_STEPS.length - 1);
      setScanStep(step);
    }, 5000);
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Header */}
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

      <main className="flex-1 flex flex-col items-center justify-center px-4">
        {view === 'idle' && (
          <IdleView
            url={url}
            setUrl={setUrl}
            urlError={urlError}
            submitting={submitting}
            onSubmit={handleSubmit}
          />
        )}

        {view === 'scanning' && (
          <ScanningView scanStep={scanStep} url={url} startTime={startRef.current} />
        )}

        {view === 'results' && run && (
          <AuditReportCard run={run} token={token} onRunAnother={() => { setView('idle'); setUrl(''); setRun(null); }} />
        )}

        {view === 'error' && (
          <ErrorView message={errorMsg} onRetry={() => { setView('idle'); setErrorMsg(''); }} />
        )}
      </main>

      <footer className="border-t border-gray-800 px-6 py-4 text-center text-xs text-gray-600">
        Reports expire after 24 hours. &copy; Atlas — atlas.vimi.digital
      </footer>
    </div>
  );
}

// ── Idle view ─────────────────────────────────────────────────────────────────

function IdleView({
  url, setUrl, urlError, submitting, onSubmit,
}: {
  url: string;
  setUrl: (v: string) => void;
  urlError: string;
  submitting: boolean;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <div className="max-w-xl w-full text-center space-y-8">
      <div className="space-y-3">
        <h1 className="text-4xl font-bold tracking-tight">
          Instant tag audit.
          <br />
          <span className="text-indigo-400">No login required.</span>
        </h1>
        <p className="text-gray-400 text-lg">
          Paste any URL and get a scored report on your GTM setup, pixels, consent mode, and more — in under 30 seconds.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-3">
        <div className="flex gap-2">
          <Input
            type="url"
            placeholder="https://yoursite.com"
            value={url}
            onChange={e => setUrl(e.target.value)}
            className="flex-1 bg-gray-900 border-gray-700 text-white placeholder:text-gray-500 h-12 text-base"
            autoFocus
          />
          <Button
            type="submit"
            disabled={submitting || !url.trim()}
            className="bg-indigo-600 hover:bg-indigo-500 h-12 px-6 text-base font-medium whitespace-nowrap"
          >
            {submitting ? 'Starting…' : 'Audit my site'}
          </Button>
        </div>
        {urlError && <p className="text-red-400 text-sm text-left">{urlError}</p>}
      </form>

      <div className="grid grid-cols-3 gap-4 text-sm text-gray-500">
        {[
          { label: 'Checks run', value: '8' },
          { label: 'Time to results', value: '~25s' },
          { label: 'No login needed', value: '✓' },
        ].map(stat => (
          <div key={stat.label} className="bg-gray-900 rounded-lg p-3">
            <div className="text-white text-xl font-semibold">{stat.value}</div>
            <div>{stat.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Scanning view ─────────────────────────────────────────────────────────────

function ScanningView({ scanStep, url, startTime }: { scanStep: number; url: string; startTime: number }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);
    return () => clearInterval(t);
  }, [startTime]);

  return (
    <div className="max-w-md w-full text-center space-y-8">
      <div className="space-y-2">
        <div className="w-16 h-16 mx-auto rounded-full border-4 border-indigo-500 border-t-transparent animate-spin" />
        <p className="text-gray-400 text-sm">{elapsed}s elapsed</p>
      </div>

      <div className="space-y-1">
        <p className="text-gray-300 text-sm truncate">{url}</p>
      </div>

      <div className="space-y-3 text-left">
        {SCAN_STEPS.map((step, i) => (
          <div key={step} className="flex items-center gap-3">
            <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
              i < scanStep  ? 'bg-green-500'  :
              i === scanStep ? 'bg-indigo-500 animate-pulse' :
              'bg-gray-700'
            }`}>
              {i < scanStep && <span className="text-white text-xs">✓</span>}
            </div>
            <span className={`text-sm ${i <= scanStep ? 'text-white' : 'text-gray-600'}`}>{step}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Error view ────────────────────────────────────────────────────────────────

function ErrorView({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="max-w-md w-full text-center space-y-6">
      <div className="text-red-400 text-5xl">⚠</div>
      <div>
        <p className="text-white font-medium">Audit could not complete</p>
        <p className="text-gray-400 text-sm mt-1">{message}</p>
      </div>
      <Button onClick={onRetry} className="bg-indigo-600 hover:bg-indigo-500">
        Try again
      </Button>
    </div>
  );
}
