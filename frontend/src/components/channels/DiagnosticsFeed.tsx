import { ShieldCheck } from 'lucide-react';
import { DiagnosticCard } from './DiagnosticCard';
import type { ChannelDiagnostic } from '@/types/channel';

interface DiagnosticsFeedProps {
  diagnostics: ChannelDiagnostic[];
  onResolve?: (id: string) => void;
  resolvingId?: string | null;
}

export function DiagnosticsFeed({ diagnostics, onResolve, resolvingId }: DiagnosticsFeedProps) {
  if (diagnostics.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-12 text-center">
        <ShieldCheck className="h-8 w-8 text-green-500/50" />
        <div>
          <p className="text-sm font-medium text-muted-foreground">No active diagnostics</p>
          <p className="mt-1 text-xs text-muted-foreground/70 max-w-sm mx-auto">
            Diagnostics are generated automatically when channel signal gaps or journey divergences are detected.
          </p>
        </div>
      </div>
    );
  }

  // Sort: critical → warning → info
  const sorted = [...diagnostics].sort((a, b) => {
    const order = { critical: 0, warning: 1, info: 2 };
    return order[a.severity] - order[b.severity];
  });

  return (
    <div className="space-y-3">
      {sorted.map((d) => (
        <DiagnosticCard
          key={d.id}
          diagnostic={d}
          onResolve={onResolve}
          resolving={resolvingId === d.id}
        />
      ))}
    </div>
  );
}
