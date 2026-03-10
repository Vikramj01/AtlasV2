import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';

interface Props {
  title: string;
  value: string | number;
  description: string;
  tooltip?: string;
  valueColor?: 'green' | 'yellow' | 'red' | 'default';
}

const VALUE_COLOR: Record<string, string> = {
  green:   'text-green-600',
  yellow:  'text-yellow-500',
  red:     'text-red-600',
  default: 'text-foreground',
};

export function ScoreCard({ title, value, description, tooltip, valueColor = 'default' }: Props) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
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
        <p className={cn('mt-2 text-3xl font-bold tracking-tight', VALUE_COLOR[valueColor])}>{value}</p>
        <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}
