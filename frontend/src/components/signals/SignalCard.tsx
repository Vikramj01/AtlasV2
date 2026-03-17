import { useState } from 'react';
import { Edit2, Trash2, BookmarkPlus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SignalToPlatformPreview } from '@/components/signals/SignalToPlatformPreview';
import type { Signal } from '@/types/signal';

const PLATFORM_LABELS: Record<string, string> = {
  ga4: 'GA4',
  meta: 'Meta',
  google_ads: 'Google Ads',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
};

const CATEGORY_COLORS: Record<string, string> = {
  conversion: 'bg-green-50 text-green-700 border-green-200',
  engagement: 'bg-blue-50 text-blue-700 border-blue-200',
  navigation: 'bg-purple-50 text-purple-700 border-purple-200',
  custom: 'bg-orange-50 text-orange-700 border-orange-200',
};

interface Props {
  signal: Signal;
  onEdit?: (signal: Signal) => void;
  onDelete?: (signal: Signal) => void;
  /** Called when the user clicks "Add to pack" — parent handles the modal */
  onAddToPack?: (signal: Signal) => void;
}

export function SignalCard({ signal, onEdit, onDelete, onAddToPack }: Props) {
  const [showParams, setShowParams] = useState(false);
  const [showMappings, setShowMappings] = useState(false);
  const platforms = Object.keys(signal.platform_mappings ?? {});
  const canEdit = !signal.is_system && !!onEdit;
  const canDelete = !signal.is_system && !!onDelete;
  const totalParams = signal.required_params.length + signal.optional_params.length;
  const hasMappings = platforms.length > 0 || !!signal.walkeros_mapping;

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
            <code className="text-[10px] text-muted-foreground">{signal.key}</code>
          </div>
          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${CATEGORY_COLORS[signal.category] ?? ''}`}>
            {signal.category}
          </span>
        </div>

        <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2">{signal.description}</p>

        {/* Platforms */}
        {platforms.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {platforms.map((p) => (
              <span key={p} className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {PLATFORM_LABELS[p] ?? p}
              </span>
            ))}
          </div>
        )}

        {/* Expanded params */}
        {showParams && (
          <div className="mt-3 space-y-1.5 border-t pt-3">
            {signal.required_params.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Required</p>
                <div className="flex flex-wrap gap-1">
                  {signal.required_params.map((p) => (
                    <span key={p.key} className="rounded border px-1.5 py-0.5 text-[10px] font-mono">{p.key}</span>
                  ))}
                </div>
              </div>
            )}
            {signal.optional_params.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Optional</p>
                <div className="flex flex-wrap gap-1">
                  {signal.optional_params.map((p) => (
                    <span key={p.key} className="rounded border border-dashed px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">{p.key}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Platform mapping preview */}
        {showMappings && hasMappings && (
          <div className="mt-3 border-t pt-3">
            <SignalToPlatformPreview signal={signal} />
          </div>
        )}

        {/* Footer */}
        <div className="mt-3 flex items-center justify-between gap-2">
          {/* Left: text toggles */}
          <div className="flex items-center gap-2 flex-wrap">
            {totalParams > 0 && (
              <button
                type="button"
                onClick={() => { setShowParams((v) => !v); if (!showParams) setShowMappings(false); }}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                {showParams ? 'Hide params ▲' : `${totalParams} params ▾`}
              </button>
            )}
            {hasMappings && (
              <>
                {totalParams > 0 && <span className="text-[10px] text-muted-foreground/40">·</span>}
                <button
                  type="button"
                  onClick={() => { setShowMappings((v) => !v); if (!showMappings) setShowParams(false); }}
                  className="text-[10px] text-muted-foreground hover:text-foreground"
                >
                  {showMappings ? 'Hide mappings ▲' : 'Platform mappings ▾'}
                </button>
              </>
            )}
          </div>

          {/* Right: action buttons */}
          <div className="flex gap-1 shrink-0">
            {onAddToPack && (
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 text-muted-foreground hover:text-primary"
                title="Add to pack"
                onClick={() => onAddToPack(signal)}
              >
                <BookmarkPlus className="h-3 w-3" />
              </Button>
            )}
            {canEdit && (
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onEdit(signal)}>
                <Edit2 className="h-3 w-3" />
              </Button>
            )}
            {canDelete && (
              <Button size="icon" variant="ghost" className="h-6 w-6 hover:text-red-600" onClick={() => onDelete(signal)}>
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
