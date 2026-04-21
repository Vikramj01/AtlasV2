import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';

interface Props {
  title: string;
  value: string | number | null;
  description?: string;
  tooltip?: string;
  valueColor?: 'green' | 'yellow' | 'red' | 'default';
  status?: 'Healthy' | 'Needs attention' | 'Critical';
  emptyState?: { copy: string; ctaLabel: string; ctaHref: string };
}

const VALUE_COLOR: Record<string, string> = {
  green:   'text-green-600',
  yellow:  'text-yellow-500',
  red:     'text-red-600',
  default: 'text-foreground',
};

const STATUS_COLOR: Record<string, string> = {
  'Healthy':         'bg-green-100 text-green-700',
  'Needs attention': 'bg-yellow-100 text-yellow-700',
  'Critical':        'bg-red-100 text-red-700',
};

export function ScoreCard({
  title,
  value,
  description,
  tooltip,
  valueColor = 'default',
  status,
  emptyState,
}: Props) {
  const isEmpty = value === null;

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-1.5">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <div className="flex shrink-0 items-center gap-1.5">
            {status && (
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-semibold leading-none',
                  STATUS_COLOR[status],
                )}
              >
                {status}
              </span>
            )}
            {tooltip && (
              <span
                title={tooltip}
                className="cursor-help text-muted-foreground/40 hover:text-muted-foreground/60 select-none text-base leading-none"
                aria-label={tooltip}
              >
                ⓘ
              </span>
            )}
          </div>
        </div>

        {isEmpty && emptyState ? (
          <div className="mt-3 space-y-2">
            <p className="text-xs text-muted-foreground">{emptyState.copy}</p>
            <Link
              to={emptyState.ctaHref}
              className="inline-block text-xs font-medium text-[#2E75B6] hover:underline"
            >
              {emptyState.ctaLabel} →
            </Link>
          </div>
        ) : (
          <>
            <p className={cn('mt-2 text-3xl font-bold tracking-tight', VALUE_COLOR[valueColor])}>
              {value ?? '—'}
            </p>
            {description && (
              <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
