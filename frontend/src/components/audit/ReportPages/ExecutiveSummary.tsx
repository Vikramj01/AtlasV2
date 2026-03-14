import { StatusBanner } from '@/components/common/StatusBanner';
import { ScoreCard } from '@/components/common/ScoreCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ReportJSON } from '@/types/audit';

function scoreColor(score: number): 'green' | 'yellow' | 'red' {
  if (score >= 80) return 'green';
  if (score >= 60) return 'yellow';
  return 'red';
}

interface Props {
  report: ReportJSON;
}

export function ExecutiveSummary({ report }: Props) {
  const { executive_summary, comparison } = report;
  const { scores } = executive_summary;

  return (
    <div className="space-y-6">
      <StatusBanner
        status={executive_summary.overall_status}
        summary={executive_summary.business_summary}
      />

      {comparison && comparison.delta !== 0 && (
        <div className={`rounded-xl border px-5 py-4 flex items-center justify-between ${
          comparison.delta > 0
            ? 'border-green-200 bg-green-50'
            : 'border-red-100 bg-red-50'
        }`}>
          <div>
            <p className={`text-sm font-semibold ${comparison.delta > 0 ? 'text-green-800' : 'text-red-800'}`}>
              {comparison.delta > 0 ? 'Tracking improved since last audit' : 'Tracking regressed since last audit'}
            </p>
            <p className={`text-xs mt-0.5 ${comparison.delta > 0 ? 'text-green-700' : 'text-red-700'}`}>
              Signal Health: {comparison.previous_score} &rarr; {comparison.current_score} ({comparison.delta > 0 ? '+' : ''}{comparison.delta} points) &middot; Previous audit: {new Date(comparison.previous_audit_date).toLocaleDateString()}
            </p>
          </div>
          <span className={`text-2xl font-bold tabular-nums ${comparison.delta > 0 ? 'text-green-600' : 'text-red-600'}`}>
            {comparison.delta > 0 ? `+${comparison.delta}` : comparison.delta}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ScoreCard
          title="Conversion Signal Health"
          value={`${scores.conversion_signal_health} / 100`}
          valueColor={scoreColor(scores.conversion_signal_health)}
          description={
            scores.conversion_signal_health >= 80
              ? 'Signals are reaching your ad platforms.'
              : scores.conversion_signal_health >= 60
              ? 'Most signals are reaching ad platforms, but key data is missing.'
              : 'Significant gaps are preventing accurate conversion tracking.'
          }
          tooltip="Percentage of the 26 signal checks that passed."
        />
        <ScoreCard
          title="Attribution Risk"
          value={scores.attribution_risk_level}
          valueColor={
            scores.attribution_risk_level === 'Low' ? 'green'
            : scores.attribution_risk_level === 'Medium' ? 'yellow'
            : 'red'
          }
          description="Likelihood that ad click IDs are being lost before conversion."
          tooltip="Based on gclid, fbclid, and transaction ID capture."
        />
        <ScoreCard
          title="Optimization Strength"
          value={scores.optimization_strength}
          valueColor={
            scores.optimization_strength === 'Strong' ? 'green'
            : scores.optimization_strength === 'Moderate' ? 'yellow'
            : 'red'
          }
          description="How much user data is available to improve ad performance."
          tooltip="Based on email, phone, and user ID capture for enhanced matching."
        />
        <ScoreCard
          title="Data Consistency"
          value={scores.data_consistency_score}
          valueColor={
            scores.data_consistency_score === 'High' ? 'green'
            : scores.data_consistency_score === 'Medium' ? 'yellow'
            : 'red'
          }
          description="Consistency of event deduplication between browser and server."
          tooltip="Checks event_id consistency between client and server-side GTM."
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What This Means for Your Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {executive_summary.business_summary}
          </p>
        </CardContent>
      </Card>

      {executive_summary.overall_status === 'healthy' && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-5 text-center">
          <p className="font-semibold text-green-800">All signals are functioning correctly.</p>
          <p className="mt-1 text-sm text-green-700">You can scale paid campaigns with confidence.</p>
        </div>
      )}
    </div>
  );
}
