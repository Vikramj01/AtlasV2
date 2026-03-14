import { ProgressBar } from './ProgressBar';
import type { ImplementationProgress } from '@/types/planning';

interface DeveloperHeaderProps {
  siteUrl: string;
  preparedBy: string;
  generatedAt: string;
  progress: ImplementationProgress;
}

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
    <header className="border-b border-border bg-background">
      <div className="mx-auto max-w-3xl px-6 py-5">
        {/* Top row: brand + title */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold tracking-tight text-foreground">Atlas</span>
            <span className="text-xs text-muted-foreground/60">|</span>
            <span className="text-sm text-muted-foreground">Developer Implementation View</span>
          </div>
        </div>

        {/* Site info */}
        <div className="mb-4 grid gap-1 text-sm">
          <div className="flex items-baseline gap-2">
            <span className="font-medium text-foreground">{siteUrl}</span>
          </div>
          <p className="text-xs text-muted-foreground">
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
