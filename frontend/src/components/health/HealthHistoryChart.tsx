/**
 * HealthHistoryChart — 30-day score trend line chart.
 *
 * Design spec: "Line chart, navy colour, 30-day window."
 * Pure SVG — no external chart library.
 *
 * Navy line (#1B2A4A) with a light navy gradient fill below.
 * Grid lines at 25/50/75/100 score levels.
 * Hover dots show score + date on each data point.
 */

import { useState } from 'react';
import type { HealthSnapshot } from '@/types/health';

interface HealthHistoryChartProps {
  snapshots: HealthSnapshot[];
}

const NAVY       = '#1B2A4A';
const NAVY_LIGHT = '#EEF1F7';
const GRID_COLOR = '#E5E7EB';

// Chart dimensions (viewBox)
const VB_W = 600;
const VB_H = 120;
const PAD_L = 32;   // left padding for Y labels
const PAD_R = 8;
const PAD_T = 8;
const PAD_B = 24;   // bottom padding for X labels

const PLOT_W = VB_W - PAD_L - PAD_R;
const PLOT_H = VB_H - PAD_T - PAD_B;

function toX(i: number, n: number) {
  return PAD_L + (n <= 1 ? 0 : (i / (n - 1)) * PLOT_W);
}

function toY(score: number) {
  return PAD_T + PLOT_H - (score / 100) * PLOT_H;
}

export function HealthHistoryChart({ snapshots }: HealthHistoryChartProps) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (snapshots.length < 2) {
    return (
      <div className="flex items-center justify-center h-24 text-xs text-[#6B7280]">
        Not enough data yet — check back after more scans.
      </div>
    );
  }

  const n = snapshots.length;
  const pts = snapshots.map((s, i) => ({ x: toX(i, n), y: toY(s.overall_score), score: s.overall_score, date: s.snapshot_at }));

  // Polyline points string
  const linePoints = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  // Area fill path
  const areaPath = [
    `M ${pts[0].x.toFixed(1)},${(PAD_T + PLOT_H).toFixed(1)}`,
    ...pts.map((p) => `L ${p.x.toFixed(1)},${p.y.toFixed(1)}`),
    `L ${pts[n - 1].x.toFixed(1)},${(PAD_T + PLOT_H).toFixed(1)}`,
    'Z',
  ].join(' ');

  // X-axis labels — show first, middle, last
  const xLabels = [0, Math.floor(n / 2), n - 1].filter((i, idx, arr) => arr.indexOf(i) === idx);

  const gradientId = 'healthGrad';

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height: 120 }}
        onMouseLeave={() => setHovered(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={NAVY} stopOpacity="0.12" />
            <stop offset="100%" stopColor={NAVY} stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {/* ── Grid lines at 25 / 50 / 75 ──────────────────────────────────── */}
        {[25, 50, 75].map((level) => {
          const y = toY(level);
          return (
            <g key={level}>
              <line
                x1={PAD_L} y1={y} x2={PAD_L + PLOT_W} y2={y}
                stroke={GRID_COLOR} strokeWidth="1" strokeDasharray="3 3"
              />
              <text
                x={PAD_L - 4} y={y + 3.5}
                fontSize="9" fill="#9CA3AF"
                textAnchor="end"
              >
                {level}
              </text>
            </g>
          );
        })}

        {/* Top Y label */}
        <text x={PAD_L - 4} y={PAD_T + 4} fontSize="9" fill="#9CA3AF" textAnchor="end">100</text>

        {/* ── Area fill ───────────────────────────────────────────────────── */}
        <path d={areaPath} fill={`url(#${gradientId})`} />

        {/* ── Line — navy per design spec ──────────────────────────────────── */}
        <polyline
          points={linePoints}
          fill="none"
          stroke={NAVY}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* ── Interactive dots ──────────────────────────────────────────────── */}
        {pts.map((p, i) => (
          <g key={i}>
            {/* Invisible wider hit area */}
            <circle
              cx={p.x} cy={p.y} r="10"
              fill="transparent"
              onMouseEnter={() => setHovered(i)}
            />
            {/* Visible dot — only show hovered or last point */}
            {(hovered === i || i === n - 1) && (
              <circle
                cx={p.x} cy={p.y} r="4"
                fill={NAVY}
                stroke="white"
                strokeWidth="2"
              />
            )}
          </g>
        ))}

        {/* ── Hover tooltip ─────────────────────────────────────────────────── */}
        {hovered !== null && (() => {
          const p = pts[hovered];
          const label = new Date(p.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
          const boxW = 64;
          const boxH = 30;
          const bx = Math.min(Math.max(p.x - boxW / 2, PAD_L), PAD_L + PLOT_W - boxW);
          const by = p.y - boxH - 8;
          return (
            <g>
              <rect x={bx} y={by} width={boxW} height={boxH} rx="4" fill={NAVY} />
              <text x={bx + boxW / 2} y={by + 11} fontSize="11" fontWeight="600" fill="white" textAnchor="middle">
                {p.score}
              </text>
              <text x={bx + boxW / 2} y={by + 22} fontSize="9" fill={NAVY_LIGHT} textAnchor="middle">
                {label}
              </text>
            </g>
          );
        })()}

        {/* ── X-axis date labels ───────────────────────────────────────────── */}
        {xLabels.map((i) => {
          const p = pts[i];
          const label = new Date(p.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
          const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
          return (
            <text
              key={i}
              x={p.x} y={VB_H - 2}
              fontSize="9" fill="#9CA3AF"
              textAnchor={anchor}
            >
              {label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
