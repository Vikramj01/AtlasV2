import { Link } from 'react-router-dom';
import { CheckCircle2, Circle, MinusCircle, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface OnboardingStepProps {
  stepId: string;
  title: string;
  description: string;
  helperCopy?: string;
  status: 'complete' | 'incomplete' | 'skipped';
  required: boolean;
  ctaLabel: string;
  ctaHref?: string;
  ctaAction?: () => void;
  altCtaLabel?: string;
  altCtaAction?: () => void;
  skipLabel?: string;
  onSkip?: () => void;
  estimatedTime?: string;
  isFirst?: boolean;
}

export function OnboardingStep({
  stepId,
  title,
  description,
  helperCopy,
  status,
  required,
  ctaLabel,
  ctaHref,
  ctaAction,
  altCtaLabel,
  altCtaAction,
  skipLabel,
  onSkip,
  estimatedTime,
  isFirst = false,
}: OnboardingStepProps) {
  const isComplete = status === 'complete';
  const isSkipped = status === 'skipped';

  return (
    <div
      className={cn(
        'flex gap-3 rounded-lg border p-4 transition-colors',
        isComplete && 'border-green-100 bg-green-50/50',
        isSkipped && 'border-border bg-muted/30 opacity-70',
        !isComplete && !isSkipped && isFirst && 'border-primary/30 bg-primary/5',
        !isComplete && !isSkipped && !isFirst && 'border-border bg-white',
      )}
    >
      {/* Status icon */}
      <div className="mt-0.5 shrink-0">
        {isComplete && <CheckCircle2 className="h-5 w-5 text-green-500" />}
        {isSkipped && <MinusCircle className="h-5 w-5 text-muted-foreground" />}
        {!isComplete && !isSkipped && (
          <Circle className={cn('h-5 w-5', isFirst ? 'text-primary' : 'text-muted-foreground/40')} />
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div>
            <span
              className={cn(
                'text-sm font-medium',
                isComplete && 'text-muted-foreground line-through',
                isSkipped && 'text-muted-foreground',
                !isComplete && !isSkipped && 'text-foreground',
              )}
            >
              {title}
            </span>
            {!required && !isComplete && !isSkipped && (
              <span className="ml-2 text-xs text-muted-foreground">(optional)</span>
            )}
          </div>
          {estimatedTime && !isComplete && !isSkipped && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
              <Clock className="h-3 w-3" />
              {estimatedTime}
            </div>
          )}
        </div>

        {!isComplete && !isSkipped && (
          <>
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
            {helperCopy && (
              <p className="mt-1 text-xs text-muted-foreground/80 italic">{helperCopy}</p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {ctaHref ? (
                <Button size="sm" asChild className={cn(!isFirst && 'variant-outline')}>
                  <Link to={ctaHref}>{ctaLabel}</Link>
                </Button>
              ) : ctaAction ? (
                <Button size="sm" onClick={ctaAction} variant={isFirst ? 'default' : 'outline'}>
                  {ctaLabel}
                </Button>
              ) : null}

              {altCtaLabel && altCtaAction && (
                <Button size="sm" variant="ghost" onClick={altCtaAction} className="text-xs">
                  {altCtaLabel}
                </Button>
              )}

              {skipLabel && onSkip && (
                <button
                  type="button"
                  onClick={onSkip}
                  className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                >
                  {skipLabel}
                </button>
              )}
            </div>
          </>
        )}

        {isSkipped && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            Skipped —{' '}
            <button
              type="button"
              onClick={onSkip}
              className="underline hover:text-foreground"
            >
              undo
            </button>
          </p>
        )}
      </div>

      {/* Step ID chip */}
      <span className="shrink-0 self-start rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
        {stepId}
      </span>
    </div>
  );
}
