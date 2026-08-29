import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';

export const DESTINATION_LABELS: Record<string, string> = {
  meta:     'Meta',
  google:   'Google',
  tiktok:   'TikTok',
  linkedin: 'LinkedIn',
  snapchat: 'Snapchat',
};

export const DESTINATION_COLORS: Record<string, string> = {
  meta:     'bg-console-primary/10 text-console-primary',
  google:   'bg-console-red/10 text-console-red',
  tiktok:   'bg-console-chip text-console-fg-muted',
  linkedin: 'bg-console-cyan/10 text-console-cyan',
  snapchat: 'bg-console-amber/10 text-console-amber',
};

export function statusBadge(status: string): ReactNode {
  const success = status === 'delivered';
  const failure = status === 'delivery_failed' || status === 'dead_letter';
  const blocked = status === 'consent_blocked';

  if (success) return <Badge className="border-0 bg-console-green/10 text-console-green text-xs">Success</Badge>;
  if (failure) return <Badge className="border-0 bg-console-red/10 text-console-red text-xs">Failed</Badge>;
  if (blocked) return <Badge className="border-0 bg-console-amber/10 text-console-amber text-xs">Blocked</Badge>;
  return <Badge variant="outline" className="text-xs text-console-fg-subtle">{status}</Badge>;
}

export function dedupBadge(dedup: string | null): ReactNode {
  if (!dedup || dedup === 'not_applicable') return <span className="text-xs text-console-fg-disabled">—</span>;
  if (dedup === 'hit')  return <Badge className="border-0 bg-console-green/10 text-console-green text-xs">Matched</Badge>;
  if (dedup === 'miss') return <Badge className="border-0 bg-console-amber/10 text-console-amber text-xs">Unmatched</Badge>;
  return <span className="text-xs text-console-fg-subtle">{dedup}</span>;
}
