import type { OrgDailyCost } from '@/types/usage';

interface Props {
  data: OrgDailyCost[];
}

const W = 600;
const H = 140;
const PAD = { top: 8, right: 8, bottom: 28, left: 44 };

export function CostTrendChart({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="flex h-36 items-center justify-center text-sm text-muted-foreground">
        No data for this period.
      </div>
    );
  }

  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const maxCost = Math.max(...data.map((d) => d.scan_cost_usd + d.ai_cost_usd), 0.001);
  const barW = Math.max(2, Math.floor((chartW / data.length) * 0.7));
  const gap  = chartW / data.length;

  // Y-axis ticks
  const topTick = parseFloat(maxCost.toFixed(maxCost < 1 ? 4 : 2));
  const midTick = topTick / 2;

  function y(val: number) {
    return PAD.top + chartH - (val / maxCost) * chartH;
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      aria-label="30-day cost trend"
    >
      {/* Y-axis guide lines */}
      {[0, midTick, topTick].map((tick) => (
        <g key={tick}>
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(tick)}
            y2={y(tick)}
            stroke="#e5e7eb"
            strokeDasharray={tick === 0 ? undefined : '3 3'}
          />
          <text
            x={PAD.left - 4}
            y={y(tick) + 4}
            textAnchor="end"
            fontSize={9}
            fill="#9ca3af"
          >
            ${tick.toFixed(tick < 0.01 ? 4 : 2)}
          </text>
        </g>
      ))}

      {/* Bars */}
      {data.map((d, i) => {
        const cx = PAD.left + i * gap + gap / 2;
        const x  = cx - barW / 2;

        const scanH = (d.scan_cost_usd / maxCost) * chartH;
        const aiH   = (d.ai_cost_usd   / maxCost) * chartH;
        const totalH = scanH + aiH;

        // X-axis label — show every 5th or first/last
        const showLabel = i === 0 || i === data.length - 1 || (i + 1) % 5 === 0;
        const label = d.date.slice(5); // MM-DD

        return (
          <g key={d.date}>
            {/* Scan cost (bottom, blue) */}
            {scanH > 0 && (
              <rect
                x={x}
                y={y(d.scan_cost_usd)}
                width={barW}
                height={scanH}
                fill="#3b82f6"
                opacity={0.8}
                rx={1}
              />
            )}
            {/* AI cost (top, violet) */}
            {aiH > 0 && (
              <rect
                x={x}
                y={y(d.scan_cost_usd + d.ai_cost_usd)}
                width={barW}
                height={aiH}
                fill="#7c3aed"
                opacity={0.8}
                rx={1}
              />
            )}
            {/* Zero-height placeholder so empty days show a tick */}
            {totalH === 0 && (
              <line x1={cx} x2={cx} y1={y(0) - 2} y2={y(0)} stroke="#e5e7eb" />
            )}
            {showLabel && (
              <text
                x={cx}
                y={H - PAD.bottom + 12}
                textAnchor="middle"
                fontSize={8}
                fill="#9ca3af"
              >
                {label}
              </text>
            )}
          </g>
        );
      })}

      {/* Legend */}
      <rect x={PAD.left} y={H - 10} width={8} height={6} fill="#3b82f6" opacity={0.8} rx={1} />
      <text x={PAD.left + 11} y={H - 5} fontSize={8} fill="#6b7280">Scan</text>
      <rect x={PAD.left + 42} y={H - 10} width={8} height={6} fill="#7c3aed" opacity={0.8} rx={1} />
      <text x={PAD.left + 53} y={H - 5} fontSize={8} fill="#6b7280">AI</text>
    </svg>
  );
}
