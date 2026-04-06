/**
 * OverallScoreRing — circular progress ring showing the overall health score.
 *
 * Design spec:
 *   "Score Circle: 180px diameter, Navy stroke."
 *   "Guidance: Plain-language interpretation is critical below the score."
 *
 * Ring: always navy (#1B2A4A) stroke — clean, brand-consistent.
 * Score: large semibold number, coloured by severity for quick scanning.
 * Below: plain-English sentence + severity-coloured status label.
 */

// ── Score interpretation helpers ──────────────────────────────────────────────

function scoreStatus(score: number): 'critical' | 'warning' | 'success' {
  if (score >= 80) return 'success';
  if (score >= 60) return 'warning';
  return 'critical';
}

const STATUS_COLOR: Record<'critical' | 'warning' | 'success', string> = {
  success:  '#059669',
  warning:  '#D97706',
  critical: '#DC2626',
};

const STATUS_LABEL: Record<'critical' | 'warning' | 'success', string> = {
  success:  'Healthy',
  warning:  'Needs attention',
  critical: 'Critical issues',
};

function plainLanguageGuide(score: number): string {
  if (score >= 90) return 'Your tracking is in excellent shape. Keep monitoring for drift.';
  if (score >= 80) return 'Your tracking is healthy. A few minor gaps remain — review the alerts below.';
  if (score >= 70) return 'Your tracking is mostly working, but some signals are missing or misconfigured.';
  if (score >= 60) return 'Several tracking gaps detected. Ad platforms may be under-optimising your spend.';
  if (score >= 40) return 'Significant tracking issues found. Your attribution data is likely incomplete.';
  return 'Critical tracking failures detected. Take action to avoid major attribution loss.';
}

// ── Component ─────────────────────────────────────────────────────────────────

interface OverallScoreRingProps {
  score: number;      // 0–100
  computedAt: string;
}

const NAVY = '#1B2A4A';
const NAVY_LIGHT = '#EEF1F7'; // track background

export function OverallScoreRing({ score, computedAt }: OverallScoreRingProps) {
  // Design spec: 180px diameter → radius 90 → usable radius with stroke padding
  const SIZE = 180;
  const STROKE = 10;
  const RADIUS = (SIZE - STROKE) / 2;  // 85
  const CX = SIZE / 2;                  // 90
  const circumference = 2 * Math.PI * RADIUS;
  const dashOffset = circumference - (Math.max(0, Math.min(100, score)) / 100) * circumference;

  const status = scoreStatus(score);
  const scoreColor = STATUS_COLOR[status];

  const formattedAt = new Date(computedAt).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  return (
    <div className="flex flex-col items-center gap-4">
      {/* ── Ring ──────────────────────────────────────────────────────────── */}
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          {/* Track — light navy */}
          <circle
            cx={CX} cy={CX} r={RADIUS}
            fill="none"
            stroke={NAVY_LIGHT}
            strokeWidth={STROKE}
          />
          {/* Progress arc — navy stroke per design spec */}
          <circle
            cx={CX} cy={CX} r={RADIUS}
            fill="none"
            stroke={NAVY}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            transform={`rotate(-90 ${CX} ${CX})`}
            style={{ transition: 'stroke-dashoffset 0.7s ease' }}
          />
        </svg>

        {/* Score text inside ring */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
          {/* Score number — 36px semibold, severity-coloured */}
          <span
            className="text-[36px] font-semibold leading-none tabular-nums"
            style={{ color: scoreColor }}
          >
            {score}
          </span>
          <span className="text-xs text-[#6B7280] font-medium">/ 100</span>
        </div>
      </div>

      {/* ── Status label + plain-language guidance ────────────────────────── */}
      <div className="text-center max-w-[200px]">
        {/* Status label — severity coloured */}
        <p className="text-sm font-semibold mb-1" style={{ color: scoreColor }}>
          {STATUS_LABEL[status]}
        </p>
        {/* Plain-language interpretation — design spec: "critical below the score" */}
        <p className="text-xs text-[#6B7280] leading-relaxed">
          {plainLanguageGuide(score)}
        </p>
        <p className="text-[10px] text-[#9CA3AF] mt-2">
          Updated {formattedAt}
        </p>
      </div>
    </div>
  );
}
