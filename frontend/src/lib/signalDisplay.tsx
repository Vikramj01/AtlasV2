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
  meta:     'bg-blue-100 text-blue-800',
  google:   'bg-red-100 text-red-800',
  tiktok:   'bg-gray-100 text-gray-800',
  linkedin: 'bg-sky-100 text-sky-800',
  snapchat: 'bg-yellow-100 text-yellow-800',
};

export function statusBadge(status: string): ReactNode {
  const success = status === 'delivered';
  const failure = status === 'delivery_failed' || status === 'dead_letter';
  const blocked = status === 'consent_blocked';

  if (success) return <Badge className="border-0 bg-[#DCFCE7] text-[#166534] text-xs">Success</Badge>;
  if (failure) return <Badge className="border-0 bg-[#FEE2E2] text-[#991B1B] text-xs">Failed</Badge>;
  if (blocked) return <Badge className="border-0 bg-[#FEF3C7] text-[#92400E] text-xs">Blocked</Badge>;
  return <Badge variant="outline" className="text-xs text-[#6B7280]">{status}</Badge>;
}

export function dedupBadge(dedup: string | null): ReactNode {
  if (!dedup || dedup === 'not_applicable') return <span className="text-xs text-[#9CA3AF]">—</span>;
  if (dedup === 'hit')  return <Badge className="border-0 bg-[#DCFCE7] text-[#166534] text-xs">Matched</Badge>;
  if (dedup === 'miss') return <Badge className="border-0 bg-[#FEF3C7] text-[#92400E] text-xs">Unmatched</Badge>;
  return <span className="text-xs text-[#6B7280]">{dedup}</span>;
}
