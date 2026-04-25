import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { strategyApi } from '@/lib/api/strategyApi';
import { SectionErrorBoundary } from '@/components/common/ErrorBoundary';
import { NextActionCard } from '@/components/dashboard/NextActionCard';
import { ScoreCard } from '@/components/common/ScoreCard';
import { RecentActivityFeed } from '@/components/dashboard/RecentActivityFeed';
import { dashboardApi } from '@/lib/api/dashboardApi';
import { Download, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AtlasScore } from '@/types/dashboard';
import type { StrategyBriefRecord } from '@/types/strategy';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function StrategyBriefReadyCard({ brief }: { brief: StrategyBriefRecord }) {
  const navigate = useNavigate();
  const [pdfLoading, setPdfLoading] = useState(false);

  async function handleDownload() {
    setPdfLoading(true);
    try {
      const res = await strategyApi.exportBriefPdf(brief.id);
      const a = document.createElement('a');
      a.href = res.data.url;
      a.download = res.data.filename;
      a.click();
    } catch {
      // fail silently — user can download from the brief page
    } finally {
      setPdfLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-green-200 bg-green-50 px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-100">
          <FileText className="size-4 text-green-700" />
        </div>
        <div>
          <p className="text-sm font-semibold text-green-900">
            Strategy Brief ready
            {brief.brief_name ? ` — ${brief.brief_name}` : ''}
          </p>
          <p className="text-xs text-green-700">
            Locked {new Date(brief.locked_at!).toLocaleDateString()} · v{brief.version_no}
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="border-green-300 text-green-800 hover:bg-green-100 text-xs" onClick={handleDownload} disabled={pdfLoading}>
          <Download className="size-3 mr-1.5" />
          {pdfLoading ? 'Generating…' : 'Download PDF'}
        </Button>
        <Button size="sm" variant="ghost" className="text-green-800 text-xs" onClick={() => navigate(`/strategy/briefs/${brief.id}`)}>
          View brief
        </Button>
      </div>
    </div>
  );
}

function getTimeOfDayGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function getSubline(): string {
  const h = new Date().getHours();
  if (h < 12) return "Here's what needs your attention today.";
  if (h < 17) return 'Your tracking signals are being monitored.';
  return "Let's keep your data quality sharp.";
}

function scoreStatus(value: number): 'Healthy' | 'Needs attention' | 'Critical' {
  if (value >= 80) return 'Healthy';
  if (value >= 60) return 'Needs attention';
  return 'Critical';
}

function setupStatus(steps: number): 'Healthy' | 'Needs attention' | 'Critical' {
  if (steps >= 3) return 'Healthy';
  if (steps >= 2) return 'Needs attention';
  return 'Critical';
}

export function HomePage() {
  const [firstName, setFirstName] = useState('');
  const [score, setScore] = useState<AtlasScore | null>(null);
  const [scoreLoading, setScoreLoading] = useState(true);
  const [recentBrief, setRecentBrief] = useState<StrategyBriefRecord | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const fullName = (data.user?.user_metadata?.full_name as string | undefined) ?? '';
      setFirstName(fullName.split(' ')[0] ?? '');
    });
  }, []);

  useEffect(() => {
    dashboardApi
      .getAtlasScore()
      .then((r) => setScore(r.data))
      .catch(() => {})
      .finally(() => setScoreLoading(false));
  }, []);

  useEffect(() => {
    const now = Date.now();
    strategyApi.listBriefs()
      .then((res) => {
        const recent = (res.data ?? [])
          .filter((b) => b.locked_at && now - new Date(b.locked_at).getTime() < SEVEN_DAYS_MS)
          .sort((a, b) => new Date(b.locked_at!).getTime() - new Date(a.locked_at!).getTime())[0] ?? null;
        setRecentBrief(recent);
      })
      .catch(() => {});
  }, []);

  const setupSteps = score ? Math.min(3, Math.round(score.foundation / 33.34)) : null;

  return (
    <div className="px-6 py-8 max-w-5xl space-y-8">

      {/* ── Greeting ─────────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-page-title">
          {getTimeOfDayGreeting()}{firstName ? `, ${firstName}` : ''}.
        </h1>
        <p className="mt-1 text-body text-[#6B7280]">{getSubline()}</p>
      </div>

      {/* ── Recently locked brief ────────────────────────────────────────────── */}
      {recentBrief && <StrategyBriefReadyCard brief={recentBrief} />}

      {/* ── Next Action ──────────────────────────────────────────────────────── */}
      <SectionErrorBoundary label="Next action">
        <NextActionCard />
      </SectionErrorBoundary>

      {/* ── Score tiles ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {scoreLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl bg-[#F3F4F6]" />
          ))
        ) : (
          <>
            <ScoreCard
              title="Atlas Score"
              value={score ? score.overall : null}
              description="Overall signal health"
              status={score ? scoreStatus(score.overall) : undefined}
              emptyState={{
                copy: 'No score yet. Complete setup to see your Atlas Score.',
                ctaLabel: 'Set up tracking',
                ctaHref: '/planning',
              }}
            />
            <ScoreCard
              title="Setup"
              value={setupSteps !== null ? `${setupSteps}/3 steps` : null}
              description="Tracking setup progress"
              status={setupSteps !== null ? setupStatus(setupSteps) : undefined}
              emptyState={{
                copy: 'Get started by setting up your tracking.',
                ctaLabel: 'Start setup',
                ctaHref: '/planning',
              }}
            />
            <ScoreCard
              title="Match Quality"
              value={score ? score.signal_quality : null}
              description="Signal quality score"
              status={score ? scoreStatus(score.signal_quality) : undefined}
              emptyState={{
                copy: 'Run a health check to see match quality.',
                ctaLabel: 'Check health',
                ctaHref: '/health',
              }}
            />
            <ScoreCard
              title="Channel Leaks"
              value={score ? `${score.channel_performance}%` : null}
              description="Channel performance"
              status={score ? scoreStatus(score.channel_performance) : undefined}
              emptyState={{
                copy: 'Ingest session data to see channel leaks.',
                ctaLabel: 'View channels',
                ctaHref: '/channels',
              }}
            />
          </>
        )}
      </div>

      {/* ── Recent Activity ──────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-section-header mb-3">Recent activity</h2>
        <SectionErrorBoundary label="Recent activity">
          <RecentActivityFeed />
        </SectionErrorBoundary>
      </div>

    </div>
  );
}
