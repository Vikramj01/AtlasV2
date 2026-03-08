import { useState } from 'react';
import type { PlanningRecommendation } from '@/types/planning';

interface AnnotatedScreenshotProps {
  screenshotUrl: string | null;
  recommendations: PlanningRecommendation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Native screenshot dimensions (e.g. 1280×800). Used to compute % positions. */
  screenshotWidth?: number;
  screenshotHeight?: number;
}

/**
 * Renders a page screenshot with numbered bounding-box overlays for each
 * recommendation. Positions are percentage-based so they scale with the
 * container width.
 *
 * Desktop-only (≥1024px). Below that width, we skip the overlay but still
 * show the screenshot.
 */
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

  // Only show annotations for recommendations that have a bounding box
  const annotated = recommendations.filter(
    (r) =>
      r.bbox_x !== null &&
      r.bbox_y !== null &&
      r.bbox_width !== null &&
      r.bbox_height !== null,
  );

  if (!screenshotUrl || imgError) {
    return (
      <div className="flex aspect-video items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50">
        <p className="text-sm text-gray-400">
          {imgError ? 'Screenshot unavailable' : 'No screenshot captured'}
        </p>
      </div>
    );
  }

  return (
    <div className="relative w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-100">
      {/* Screenshot */}
      <img
        src={screenshotUrl}
        alt="Page screenshot"
        className="w-full"
        onLoad={() => setImgLoaded(true)}
        onError={() => setImgError(true)}
        draggable={false}
      />

      {/* Loading shimmer */}
      {!imgLoaded && (
        <div className="absolute inset-0 animate-pulse bg-gray-200" />
      )}

      {/* Bounding-box overlays */}
      {imgLoaded &&
        annotated.map((rec, idx) => {
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
              className={`group cursor-pointer rounded transition-all ${
                isSelected
                  ? 'bg-brand-500/20 ring-2 ring-brand-500'
                  : 'bg-transparent hover:bg-brand-400/10 hover:ring-2 hover:ring-brand-400'
              }`}
            >
              {/* Number badge */}
              <span
                className={`absolute -top-3 -left-1 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold shadow ${
                  isSelected
                    ? 'bg-brand-600 text-white'
                    : 'bg-white text-gray-700 ring-1 ring-gray-300 group-hover:bg-brand-100 group-hover:text-brand-700'
                }`}
              >
                {number}
              </span>
            </button>
          );
        })}
    </div>
  );
}
