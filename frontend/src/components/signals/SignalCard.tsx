import { useState } from 'react';
import { Edit2, Trash2, BookmarkPlus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SignalToPlatformPreview } from '@/components/signals/SignalToPlatformPreview';
import type { Signal } from '@/types/signal';

const PLATFORM_LABELS: Record<string, string> = {
  ga4:        'GA4',
  meta:       'Meta',
  google_ads: 'Google Ads',
  tiktok:     'TikTok',
  linkedin:   'LinkedIn',
};

// Category pill — aligned to design system palette
const CATEGORY_STYLES: Record<string, { bg: string; color: string; border: string }> = {
  conversion: { bg: '#F0FDF4', color: '#059669', border: '#059669' },
  engagement: { bg: '#EEF1F7', color: '#1B2A4A', border: '#1B2A4A' },
  navigation: { bg: '#FFFBEB', color: '#D97706', border: '#D97706' },
  custom:     { bg: '#FEF2F2', color: '#DC2626', border: '#DC2626' },
};

interface Props {
  signal: Signal;
  view?: 'grid' | 'list';
  className?: string;
  onEdit?: (signal: Signal) => void;
  onDelete?: (signal: Signal) => void;
  onAddToPack?: (signal: Signal) => void;
}

// ── Shared category pill ───────────────────────────────────────────────────────
function CategoryPill({ category }: { category: string }) {
  const style = CATEGORY_STYLES[category];
  if (!style) return null;
  return (
    <span
      className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold"
      style={{ backgroundColor: style.bg, color: style.color, borderColor: `${style.border}40` }}
    >
      {category}
    </span>
  );
}

// ── Action buttons (shared) ────────────────────────────────────────────────────
function ActionButtons({
  signal,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
  onAddToPack,
}: {
  signal: Signal;
  canEdit: boolean;
  canDelete: boolean;
  onEdit?: (signal: Signal) => void;
  onDelete?: (signal: Signal) => void;
  onAddToPack?: (signal: Signal) => void;
}) {
  return (
    <div className="flex gap-1 shrink-0">
      {onAddToPack && (
        <Button size="icon" variant="ghost" className="h-6 w-6 text-[#9CA3AF] hover:text-[#1B2A4A]" title="Add to pack" onClick={() => onAddToPack(signal)}>
          <BookmarkPlus className="h-3 w-3" />
        </Button>
      )}
      {canEdit && onEdit && (
        <Button size="icon" variant="ghost" className="h-6 w-6 text-[#9CA3AF] hover:text-[#1A1A1A]" onClick={() => onEdit(signal)}>
          <Edit2 className="h-3 w-3" />
        </Button>
      )}
      {canDelete && onDelete && (
        <Button size="icon" variant="ghost" className="h-6 w-6 text-[#9CA3AF] hover:text-[#DC2626]" onClick={() => onDelete(signal)}>
          <Trash2 className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}

// ── Grid card variant ─────────────────────────────────────────────────────────
function GridCard({ signal, onEdit, onDelete, onAddToPack }: Props) {
  const [showParams, setShowParams] = useState(false);
  const [showMappings, setShowMappings] = useState(false);
  const platforms = Object.keys(signal.platform_mappings ?? {});
  const canEdit = !signal.is_system && !!onEdit;
  const canDelete = !signal.is_system && !!onDelete;
  const totalParams = signal.required_params.length + signal.optional_params.length;
  const hasMappings = platforms.length > 0;

  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-xs font-bold truncate">{signal.name}</p>
              {signal.is_system && (
                <Badge variant="secondary" className="text-[10px] shrink-0">System</Badge>
              )}
            </div>
            <code className="text-[10px] text-[#9CA3AF]">{signal.key}</code>
          </div>
          <CategoryPill category={signal.category} />
        </div>

        <p className="mt-1.5 text-xs text-[#6B7280] line-clamp-2">{signal.description}</p>

        {platforms.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {platforms.map((p) => (
              <span key={p} className="rounded bg-[#F3F4F6] px-1.5 py-0.5 text-[10px] font-medium text-[#6B7280]">
                {PLATFORM_LABELS[p] ?? p}
              </span>
            ))}
          </div>
        )}

        {showParams && (
          <div className="mt-3 space-y-1.5 border-t border-[#E5E7EB] pt-3">
            {signal.required_params.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wide mb-1">Required</p>
                <div className="flex flex-wrap gap-1">
                  {signal.required_params.map((p) => (
                    <span key={p.key} className="rounded border border-[#E5E7EB] px-1.5 py-0.5 text-[10px] font-mono">{p.key}</span>
                  ))}
                </div>
              </div>
            )}
            {signal.optional_params.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wide mb-1">Optional</p>
                <div className="flex flex-wrap gap-1">
                  {signal.optional_params.map((p) => (
                    <span key={p.key} className="rounded border border-dashed border-[#E5E7EB] px-1.5 py-0.5 text-[10px] font-mono text-[#9CA3AF]">{p.key}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {showMappings && hasMappings && (
          <div className="mt-3 border-t border-[#E5E7EB] pt-3">
            <SignalToPlatformPreview signal={signal} />
          </div>
        )}

        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            {totalParams > 0 && (
              <button
                type="button"
                onClick={() => { setShowParams((v) => !v); if (!showParams) setShowMappings(false); }}
                className="text-[10px] text-[#9CA3AF] hover:text-[#1A1A1A] transition-colors"
              >
                {showParams ? 'Hide params ▲' : `${totalParams} params ▾`}
              </button>
            )}
            {hasMappings && (
              <>
                {totalParams > 0 && <span className="text-[10px] text-[#D1D5DB]">·</span>}
                <button
                  type="button"
                  onClick={() => { setShowMappings((v) => !v); if (!showMappings) setShowParams(false); }}
                  className="text-[10px] text-[#9CA3AF] hover:text-[#1A1A1A] transition-colors"
                >
                  {showMappings ? 'Hide mappings ▲' : 'Platform mappings ▾'}
                </button>
              </>
            )}
          </div>
          <ActionButtons signal={signal} canEdit={canEdit} canDelete={canDelete} onEdit={onEdit} onDelete={onDelete} onAddToPack={onAddToPack} />
        </div>
      </CardContent>
    </Card>
  );
}

// ── List row variant ──────────────────────────────────────────────────────────
function ListRow({ signal, className, onEdit, onDelete, onAddToPack }: Props) {
  const platforms = Object.keys(signal.platform_mappings ?? {});
  const canEdit = !signal.is_system && !!onEdit;
  const canDelete = !signal.is_system && !!onDelete;

  return (
    <div className={`flex items-center gap-3 bg-white px-4 py-3 ${className ?? ''}`}>
      {/* Name + key */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-[#1A1A1A] truncate">{signal.name}</p>
          {signal.is_system && (
            <Badge variant="secondary" className="text-[10px] shrink-0">System</Badge>
          )}
        </div>
        <code className="text-[10px] text-[#9CA3AF]">{signal.key}</code>
      </div>

      {/* Description (hidden on small screens) */}
      <p className="hidden md:block text-xs text-[#6B7280] line-clamp-1 flex-[2] min-w-0">
        {signal.description}
      </p>

      {/* Platform badges */}
      <div className="hidden sm:flex flex-wrap gap-1 w-40 justify-end shrink-0">
        {platforms.slice(0, 3).map((p) => (
          <span key={p} className="rounded bg-[#F3F4F6] px-1.5 py-0.5 text-[10px] font-medium text-[#6B7280]">
            {PLATFORM_LABELS[p] ?? p}
          </span>
        ))}
        {platforms.length > 3 && (
          <span className="text-[10px] text-[#9CA3AF]">+{platforms.length - 3}</span>
        )}
      </div>

      {/* Category pill */}
      <div className="shrink-0">
        <CategoryPill category={signal.category} />
      </div>

      {/* Actions */}
      <ActionButtons signal={signal} canEdit={canEdit} canDelete={canDelete} onEdit={onEdit} onDelete={onDelete} onAddToPack={onAddToPack} />
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export function SignalCard(props: Props) {
  if (props.view === 'list') return <ListRow {...props} />;
  return <GridCard {...props} />;
}
