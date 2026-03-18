/**
 * ReadinessScore — First-Party Data Readiness Score widget.
 *
 * Composite score (0–100) showing how mature the user's tracking setup is.
 * Each item links directly to the feature that addresses it.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Circle, ArrowRight } from 'lucide-react';
import { readinessApi } from '@/lib/api/readinessApi';
import type { ReadinessScore as ReadinessScoreType, ReadinessItem } from '@/lib/api/readinessApi';

const LEVEL_COLORS: Record<ReadinessScoreType['level'], string> = {
  getting_started: 'text-red-600',
  building:        'text-amber-600',
  strong:          'text-blue-600',
  best_in_class:   'text-green-600',
};

const LEVEL_BAR_COLORS: Record<ReadinessScoreType['level'], string> = {
  getting_started: 'bg-red-500',
  building:        'bg-amber-500',
  strong:          'bg-blue-500',
  best_in_class:   'bg-green-500',
};

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
    return (
      <div className="rounded-xl border bg-card px-5 py-5 animate-pulse">
        <div className="h-4 bg-muted rounded w-48 mb-4" />
        <div className="h-2 bg-muted rounded w-full mb-4" />
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-4 bg-muted rounded w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const incomplete = data.items.filter((i) => !i.earned);
  const nextAction = incomplete[0] ?? null;

  return (
    <div className="rounded-xl border bg-card px-5 py-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm font-semibold">First-Party Data Readiness</p>
          <p className={`text-xs font-medium mt-0.5 ${LEVEL_COLORS[data.level]}`}>
            {data.level_label}
          </p>
        </div>
        <div className="text-right">
          <span className={`text-2xl font-bold tabular-nums ${LEVEL_COLORS[data.level]}`}>
            {data.score}
          </span>
          <span className="text-xs text-muted-foreground">/100</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-2 rounded-full bg-muted overflow-hidden mb-1">
        <div
          className={`h-full rounded-full transition-all duration-500 ${LEVEL_BAR_COLORS[data.level]}`}
          style={{ width: `${data.score}%` }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground mb-4">
        <span>Getting started</span>
        <span>Building</span>
        <span>Strong</span>
        <span>Best in class</span>
      </div>

      {/* Items */}
      <div className="space-y-2">
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
      className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
        item.earned
          ? 'opacity-70 cursor-default'
          : isNext
            ? 'bg-primary/5 border border-primary/20 hover:bg-primary/10'
            : 'hover:bg-muted/50'
      }`}
    >
      {item.earned ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
      ) : (
        <Circle className={`h-4 w-4 shrink-0 ${isNext ? 'text-primary' : 'text-muted-foreground/40'}`} />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium ${item.earned ? 'line-through text-muted-foreground' : isNext ? 'text-primary' : ''}`}>
            {item.label}
          </span>
          <span className={`text-[10px] px-1 rounded ${item.earned ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground'}`}>
            +{item.points}
          </span>
        </div>
        {!item.earned && (
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{item.description}</p>
        )}
      </div>
      {!item.earned && isNext && (
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-primary" />
      )}
    </button>
  );
}
