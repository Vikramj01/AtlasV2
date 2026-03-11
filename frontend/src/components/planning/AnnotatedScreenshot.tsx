import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { PlanningRecommendation } from '@/types/planning';

interface AnnotatedScreenshotProps {
  screenshotUrl: string | null;
  recommendations: PlanningRecommendation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  screenshotWidth?: number;
  screenshotHeight?: number;
}

export function AnnotatedScreenshot({
  screenshotUrl,
  recommendations,
  selectedId,
  onSelect,
  screenshotWidth = 1280,
  screenshotHeight = 800,
}: AnnotatedScreenshotProps) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);

  const annotated = recommendations.filter(
    (r) => r.bbox_x !== null && r.bbox_y !== null && r.bbox_width !== null && r.bbox_height !== null,
  );

  if (!screenshotUrl || imgError) {
    return (
      <div className="flex aspect-video items-center justify-center rounded-lg border border-dashed bg-muted">
        <p className="text-sm text-muted-foreground">
          {imgError ? 'Screenshot unavailable' : 'No screenshot captured'}
        </p>
      </div>
    );
  }

  return (
    <div className="relative w-full overflow-hidden rounded-lg border bg-muted">
      <img
        src={screenshotUrl}
        alt="Page screenshot"
        className="w-full"
        onLoad={() => setImgLoaded(true)}
        onError={() => setImgError(true)}
        draggable={false}
      />

      {!imgLoaded && (
        <div className="absolute inset-0 animate-pulse bg-muted" />
      )}

      {imgLoaded &&
        annotated.map((rec, _idx) => {
          const left   = ((rec.bbox_x ?? 0) / screenshotWidth) * 100;
          const top    = ((rec.bbox_y ?? 0) / screenshotHeight) * 100;
          const width  = ((rec.bbox_width ?? 0) / screenshotWidth) * 100;
          const height = ((rec.bbox_height ?? 0) / screenshotHeight) * 100;
          const isSelected = rec.id === selectedId;
          const number = recommendations.findIndex((r) => r.id === rec.id) + 1;

          return (
            <button
              key={rec.id}
              onClick={() => onSelect(rec.id)}
              title={rec.event_name}
              style={{
                position: 'absolute',
                left: `${left}%`,
                top: `${top}%`,
                width: `${Math.max(width, 2)}%`,
                height: `${Math.max(height, 2)}%`,
              }}
              className={cn(
                'group cursor-pointer rounded transition-all',
                isSelected
                  ? 'bg-brand-500/20 ring-2 ring-brand-500'
                  : 'bg-transparent hover:bg-brand-400/10 hover:ring-2 hover:ring-brand-400'
              )}
            >
              <span
                className={cn(
                  'absolute -top-3 -left-1 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold shadow',
                  isSelected
                    ? 'bg-brand-600 text-white'
                    : 'bg-background text-foreground ring-1 ring-border group-hover:bg-brand-100 group-hover:text-brand-700'
                )}
              >
                {number}
              </span>
            </button>
          );
        })}
    </div>
  );
}
