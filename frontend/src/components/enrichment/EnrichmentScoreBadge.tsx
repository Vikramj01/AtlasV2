import { cn } from '@/lib/utils';
import type { ClientEnrichmentScore } from '@/types/enrichment';

interface EnrichmentScoreBadgeProps {
  score: ClientEnrichmentScore;
  onConfigure?: () => void;
  compact?: boolean;
}

function ScoreRing({ value, size = 56 }: { value: number; size?: number }) {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;
  const colour = value >= 70 ? '#22c55e' : value >= 40 ? '#f59e0b' : '#ef4444';

  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} stroke="#e5e7eb" strokeWidth={4} fill="none" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={colour}
        strokeWidth={4}
        fill="none"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.5s ease' }}
      />
    </svg>
  );
}

function EmqDots({ value }: { value: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 10 }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'w-2 h-2 rounded-full',
            i < value ? 'bg-blue-500' : 'bg-gray-200',
          )}
        />
      ))}
    </div>
  );
}

export function EnrichmentScoreBadge({ score, onConfigure, compact = false }: EnrichmentScoreBadgeProps) {
  const overallColour =
    score.overall >= 70 ? 'text-green-600' : score.overall >= 40 ? 'text-amber-600' : 'text-red-600';

  if (compact) {
    return (
      <button
        type="button"
        onClick={onConfigure}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
      >
        <div className="relative w-7 h-7">
          <ScoreRing value={score.overall} size={28} />
          <span className={cn('absolute inset-0 flex items-center justify-center text-[9px] font-bold rotate-90', overallColour)}>
            {score.overall}
          </span>
        </div>
        <span className="text-xs text-gray-600">Enrichment</span>
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">Signal Enrichment Quality</h3>
        {onConfigure && (
          <button
            type="button"
            onClick={onConfigure}
            className="text-xs text-blue-600 hover:underline"
          >
            Configure →
          </button>
        )}
      </div>

      <div className="flex items-center gap-6">
        {/* Overall score ring */}
        <div className="relative shrink-0">
          <ScoreRing value={score.overall} size={72} />
          <div className="absolute inset-0 flex flex-col items-center justify-center rotate-90">
            <span className={cn('text-xl font-bold', overallColour)}>{score.overall}</span>
            <span className="text-[10px] text-gray-400">/100</span>
          </div>
        </div>

        {/* Platform estimates */}
        <div className="flex-1 space-y-3">
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">Meta EMQ estimate</span>
              <span className="text-xs font-semibold text-gray-700">{score.estimated_meta_emq}/10</span>
            </div>
            <EmqDots value={score.estimated_meta_emq} />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">Google match rate</span>
              <span className="text-xs font-semibold text-gray-700">~{score.estimated_google_match_rate}%</span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-1.5">
              <div
                className="bg-blue-500 h-1.5 rounded-full transition-all duration-500"
                style={{ width: `${score.estimated_google_match_rate}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Signal breakdown */}
      {score.signal_scores.length > 0 && (
        <div className="border-t border-gray-100 pt-3 space-y-1.5">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Conversion signals</p>
          {score.signal_scores.map((s) => {
            const errors = s.warnings.filter((w) => w.severity === 'error');
            const warningItems = s.warnings.filter((w) => w.severity === 'warning');
            const offlineWarnings = s.warnings.filter((w) =>
              w.field === 'TIME_02' || w.field === 'TIME_03',
            );
            return (
              <div key={s.signal_key} className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-700 capitalize">{s.signal_name.replace(/_/g, ' ')}</span>
                  <div className="flex items-center gap-2">
                    {errors.length > 0 && (
                      <span className="text-[10px] text-red-600 font-medium">
                        {errors.length} error{errors.length !== 1 ? 's' : ''}
                      </span>
                    )}
                    {warningItems.length > 0 && (
                      <span className="text-[10px] text-amber-600 font-medium">
                        {warningItems.length} warning{warningItems.length !== 1 ? 's' : ''}
                      </span>
                    )}
                    <span
                      className={cn(
                        'text-xs font-semibold',
                        s.score >= 70 ? 'text-green-600' : s.score >= 40 ? 'text-amber-600' : 'text-red-600',
                      )}
                    >
                      {s.score}/100
                    </span>
                  </div>
                </div>
                {offlineWarnings.map((w, i) => (
                  <p key={i} className={cn(
                    'text-[11px] rounded px-2 py-1',
                    w.severity === 'error' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700',
                  )}>
                    {w.message}
                  </p>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
