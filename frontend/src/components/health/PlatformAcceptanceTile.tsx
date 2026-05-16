import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import type { HealthScore } from '@/types/health';

type CellStatus = 'good' | 'warning' | 'critical' | 'neutral';

const CELL_BG: Record<CellStatus, string> = {
  good:     'bg-white',
  warning:  'bg-[#FFFBEB]',
  critical: 'bg-[#FEF2F2]',
  neutral:  'bg-[#F9FAFB]',
};

const CELL_BORDER: Record<CellStatus, string> = {
  good:     'border-[#E5E7EB]',
  warning:  'border-[#D97706]/30',
  critical: 'border-[#DC2626]/30',
  neutral:  'border-[#E5E7EB]',
};

const VALUE_COLOR: Record<CellStatus, string> = {
  good:     'text-[#059669]',
  warning:  'text-[#D97706]',
  critical: 'text-[#DC2626]',
  neutral:  'text-[#6B7280]',
};

function acceptanceStatus(score: number | null): CellStatus {
  if (score === null) return 'neutral';
  if (score >= 80) return 'good';
  if (score >= 60) return 'warning';
  return 'critical';
}

interface Props {
  score: HealthScore;
}

export function PlatformAcceptanceTile({ score }: Props) {
  const navigate = useNavigate();
  const pa = score.platform_acceptance_score;
  const status = acceptanceStatus(pa);

  return (
    <div className={cn('rounded-lg border px-4 py-4', CELL_BG[status], CELL_BORDER[status])}>
      <p className="text-caption-upper mb-1">Platform Acceptance</p>
      <p className={cn('text-2xl font-semibold tabular-nums leading-tight', VALUE_COLOR[status])}>
        {pa !== null ? pa : '—'}
      </p>
      <p className="text-caption mt-1">Delivery · Config · Alignment · Volume</p>
      {pa !== null && (
        <button
          type="button"
          onClick={() => navigate('/reconciliation')}
          className="mt-2 text-xs text-[#1B2A4A] hover:underline"
        >
          View findings →
        </button>
      )}
      {pa === null && (
        <p className="mt-1 text-[10px] text-[#9CA3AF]">No reconciliation data yet</p>
      )}
    </div>
  );
}
