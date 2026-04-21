import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { SectionErrorBoundary } from '@/components/common/ErrorBoundary';
import { NextActionCard } from '@/components/dashboard/NextActionCard';
import { ScoreCard } from '@/components/common/ScoreCard';
import { RecentActivityFeed } from '@/components/dashboard/RecentActivityFeed';
import { dashboardApi } from '@/lib/api/dashboardApi';
import type { AtlasScore } from '@/types/dashboard';

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
