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
  const { executive_summary } = report;
  const { scores } = executive_summary;

  return (
    <div className="space-y-6">
      <StatusBanner
        status={executive_summary.overall_status}
        summary={executive_summary.business_summary}
      />

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
