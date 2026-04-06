import { ProgressBar } from './ProgressBar';
import type { ImplementationProgress } from '@/types/planning';

interface DeveloperHeaderProps {
  siteUrl: string;
  preparedBy: string;
  generatedAt: string;
  progress: ImplementationProgress;
}

const NAVY = '#1B2A4A';

export function DeveloperHeader({
  siteUrl,
  preparedBy,
  generatedAt,
  progress,
}: DeveloperHeaderProps) {
  const date = new Date(generatedAt).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <header className="border-b border-[#E5E7EB] bg-white" style={{ paddingTop: 0 }}>
      <div className="mx-auto max-w-3xl px-6 py-5">
        {/* Brand + title */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Navy square logo mark */}
            <div
              className="flex h-7 w-7 items-center justify-center rounded"
              style={{ backgroundColor: NAVY }}
            >
              <span className="text-xs font-bold text-white select-none">A</span>
            </div>
            <span className="text-sm font-semibold text-[#1A1A1A]">Atlas</span>
            <span className="text-[#D1D5DB] text-sm">|</span>
            <span className="text-sm text-[#6B7280]">Developer Handoff</span>
          </div>
        </div>

        {/* Site + meta */}
        <div className="mb-4 space-y-0.5">
          <p className="text-sm font-semibold text-[#1A1A1A]">{siteUrl}</p>
          <p className="text-xs text-[#9CA3AF]">
            Prepared by {preparedBy} · Generated {date}
          </p>
        </div>

        {/* Progress bar */}
        <ProgressBar
          value={progress.percent_complete}
          label={`${progress.implemented + progress.verified} / ${progress.total_pages} pages implemented`}
        />
      </div>
    </header>
  );
}
