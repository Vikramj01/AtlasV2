import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface InfoTooltipProps {
  entry: {
    label: string;
    what: string;
    why: string;
  };
  side?: 'top' | 'right' | 'bottom' | 'left';
  className?: string;
}

export function InfoTooltip({ entry, side = 'top', className }: InfoTooltipProps) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger
          className={cn('inline-flex items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-sm', className)}
          aria-label={entry.label}
        >
          <Info className="h-3.5 w-3.5 text-muted-foreground" />
        </TooltipTrigger>
        <TooltipContent
          side={side}
          avoidCollisions
          className="max-w-[280px] p-3 space-y-1.5"
        >
          <p className="text-xs font-semibold">{entry.label}</p>
          <p className="text-xs font-normal leading-relaxed">{entry.what}</p>
          <div className="border-t border-border pt-1.5">
            <p className="text-xs text-muted-foreground leading-relaxed">{entry.why}</p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
