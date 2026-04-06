/**
 * ReadinessScore — First-Party Data Readiness Score widget.
 *
 * Design spec:
 *   "Progress bars per category, navy fill. Labels 12px."
 *
 * Composite score (0–100) with a navy progress bar and checklist of items.
 * Each incomplete item links to the feature that addresses it.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Circle, ArrowRight } from 'lucide-react';
import { SkeletonCard } from '@/components/common/SkeletonCard';
import { readinessApi } from '@/lib/api/readinessApi';
import type { ReadinessScore as ReadinessScoreType, ReadinessItem } from '@/lib/api/readinessApi';

const NAVY = '#1B2A4A';

// Plain-language level labels
const LEVEL_LABEL: Record<ReadinessScoreType['level'], string> = {
  getting_started: 'Getting started',
  building:        'Building momentum',
  strong:          'Strong setup',
  best_in_class:   'Best in class',
};

const LEVEL_COLOR: Record<ReadinessScoreType['level'], string> = {
  getting_started: '#DC2626',
  building:        '#D97706',
  strong:          '#2E75B6',
  best_in_class:   '#059669',
};

// ── Single checklist item ─────────────────────────────────────────────────────

function ReadinessItemRow({
  item,
  isNext,
  onClick,
}: {
  item: ReadinessItem;
  isNext: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={item.earned ? undefined : onClick}
      disabled={item.earned}
      className={[
        'w-full flex items-center gap-3 rounded-md px-3 py-2 text-left transition-colors',
        item.earned
          ? 'cursor-default opacity-70'
          : isNext
            ? 'bg-[#EEF1F7] border border-[#1B2A4A]/20 hover:bg-[#CDD4E5]/40'
            : 'hover:bg-[#F9FAFB]',
      ].join(' ')}
    >
      {/* Status icon */}
      {item.earned ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-[#059669]" strokeWidth={1.5} />
      ) : (
        <Circle
          className="h-4 w-4 shrink-0"
          style={{ color: isNext ? NAVY : '#D1D5DB' }}
          strokeWidth={1.5}
        />
      )}

      {/* Label + description — 12px per design spec */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={[
              'text-xs font-medium',
              item.earned ? 'line-through text-[#9CA3AF]' : isNext ? 'text-[#1B2A4A]' : 'text-[#1A1A1A]',
            ].join(' ')}
          >
            {item.label}
          </span>
          <span className={[
            'text-[10px] px-1.5 py-0.5 rounded-full font-medium',
            item.earned
              ? 'bg-[#F0FDF4] text-[#059669]'
              : 'bg-[#F3F4F6] text-[#6B7280]',
          ].join(' ')}>
            +{item.points}
          </span>
        </div>
        {!item.earned && (
          <p className="text-[11px] text-[#6B7280] mt-0.5 leading-snug">{item.description}</p>
        )}
      </div>

      {/* Arrow for next action */}
      {!item.earned && isNext && (
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[#1B2A4A]" strokeWidth={1.5} />
      )}
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ReadinessScore() {
  const navigate = useNavigate();
  const [data, setData] = useState<ReadinessScoreType | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    readinessApi.getScore()
      .then(setData)
      .catch(() => { /* non-blocking */ })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <SkeletonCard variant="card" />;
  }

  if (!data) return null;

  const incomplete = data.items.filter((i) => !i.earned);
  const nextAction = incomplete[0] ?? null;
  const levelColor = LEVEL_COLOR[data.level];

  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white px-5 py-5">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-section-header text-[#1A1A1A]">Data Readiness</p>
          <p className="text-xs font-medium mt-0.5" style={{ color: levelColor }}>
            {LEVEL_LABEL[data.level]}
          </p>
        </div>
        <div className="text-right">
          <span className="text-2xl font-semibold tabular-nums" style={{ color: NAVY }}>
            {data.score}
          </span>
          <span className="text-xs text-[#6B7280]">/100</span>
        </div>
      </div>

      {/* ── Progress bar — navy fill per design spec ──────────────────────── */}
      <div className="h-1.5 rounded-full bg-[#EEF1F7] overflow-hidden mb-1">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${data.score}%`, backgroundColor: NAVY }}
        />
      </div>

      {/* ── Stage markers ─────────────────────────────────────────────────── */}
      <div className="flex justify-between text-caption mb-4">
        <span>Getting started</span>
        <span>Building</span>
        <span>Strong</span>
        <span>Best in class</span>
      </div>

      {/* ── Checklist items — 12px labels per design spec ─────────────────── */}
      <div className="space-y-0.5">
        {data.items.map((item) => (
          <ReadinessItemRow
            key={item.key}
            item={item}
            isNext={!item.earned && nextAction?.key === item.key}
            onClick={() => navigate(item.link)}
          />
        ))}
      </div>
    </div>
  );
}
