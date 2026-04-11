/**
 * NamingConventionSettings
 *
 * Modal panel for viewing and updating the org's naming convention.
 * Shows a live preview of how the current settings would format example names.
 * The "Preview renames" button calls /naming-convention/preview to show how
 * existing signals would be renamed under the proposed convention.
 */
import { useState } from 'react';
import { X, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { taxonomyApi } from '@/lib/api/taxonomyApi';
import type { NamingConvention, CaseFormat } from '@/types/taxonomy';
import type { ConventionPreviewResult } from '@/lib/api/taxonomyApi';

const CASE_FORMATS: CaseFormat[] = ['snake_case', 'camelCase', 'kebab-case', 'PascalCase'];

interface Props {
  orgId: string;
  convention: NamingConvention;
  onSaved: (updated: NamingConvention) => void;
  onClose: () => void;
}

export function NamingConventionSettings({ orgId, convention, onSaved, onClose }: Props) {
  // Local draft state
  const [eventCase, setEventCase] = useState<CaseFormat>(convention.event_case);
  const [paramCase, setParamCase] = useState<CaseFormat>(convention.param_case);
  const [eventPrefix, setEventPrefix] = useState(convention.event_prefix ?? '');
  const [paramPrefix, setParamPrefix] = useState(convention.param_prefix ?? '');
  const [maxEventLen, setMaxEventLen] = useState(convention.max_event_name_length);
  const [maxParamLen, setMaxParamLen] = useState(convention.max_param_key_length);
  const [reservedWords, setReservedWords] = useState(convention.reserved_words.join(', '));

  const [preview, setPreview] = useState<ConventionPreviewResult | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<{ renamed_count: number } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draft: Partial<NamingConvention> = {
    event_case: eventCase,
    param_case: paramCase,
    event_prefix: eventPrefix.trim() || null,
    param_prefix: paramPrefix.trim() || null,
    max_event_name_length: maxEventLen,
    max_param_key_length: maxParamLen,
    reserved_words: reservedWords
      .split(',')
      .map((w) => w.trim())
      .filter(Boolean),
  };

  async function loadPreview() {
    setIsLoadingPreview(true);
    setApplyResult(null);
    setError(null);
    try {
      const result = await taxonomyApi.previewConvention(orgId, draft);
      setPreview(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setIsLoadingPreview(false);
    }
  }

  async function handleApply() {
    if (!preview || preview.renames.length === 0) return;
    if (!window.confirm(`This will rename ${preview.renames.length} signal(s) and save your convention. Continue?`)) return;
    setIsApplying(true);
    setError(null);
    try {
      const result = await taxonomyApi.applyConvention(orgId, draft);
      setApplyResult({ renamed_count: result.renamed_count });
      setPreview(null);
      onSaved(result.convention);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Apply failed');
    } finally {
      setIsApplying(false);
    }
  }

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    try {
      const updated = await taxonomyApi.updateConvention({
        ...draft,
        organization_id: orgId,
      });
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <CardContent className="p-6 space-y-5">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold">Naming convention</h2>
              <p className="text-xs text-[#6B7280] mt-0.5">
                Rules applied when validating and generating event names for this org.
              </p>
            </div>
            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Event casing */}
          <div className="space-y-1.5">
            <Label className="text-xs">Event name format</Label>
            <div className="flex flex-wrap gap-2">
              {CASE_FORMATS.map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`rounded-full border px-3 py-1 text-xs font-mono font-medium transition-colors ${
                    eventCase === f
                      ? 'border-[#1B2A4A] bg-[#1B2A4A] text-white'
                      : 'border-[#E5E7EB] text-[#6B7280] hover:border-[#9CA3AF]'
                  }`}
                  onClick={() => setEventCase(f)}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Param casing */}
          <div className="space-y-1.5">
            <Label className="text-xs">Parameter key format</Label>
            <div className="flex flex-wrap gap-2">
              {CASE_FORMATS.map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`rounded-full border px-3 py-1 text-xs font-mono font-medium transition-colors ${
                    paramCase === f
                      ? 'border-[#1B2A4A] bg-[#1B2A4A] text-white'
                      : 'border-[#E5E7EB] text-[#6B7280] hover:border-[#9CA3AF]'
                  }`}
                  onClick={() => setParamCase(f)}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Prefixes */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="ev-prefix" className="text-xs">
                Event prefix <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="ev-prefix"
                placeholder="e.g. acme_"
                value={eventPrefix}
                onChange={(e) => setEventPrefix(e.target.value)}
                className="font-mono text-xs h-8"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pm-prefix" className="text-xs">
                Param prefix <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="pm-prefix"
                placeholder="e.g. custom_"
                value={paramPrefix}
                onChange={(e) => setParamPrefix(e.target.value)}
                className="font-mono text-xs h-8"
              />
            </div>
          </div>

          {/* Max lengths */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="max-ev" className="text-xs">Max event name length</Label>
              <Input
                id="max-ev"
                type="number"
                min={10}
                max={100}
                value={maxEventLen}
                onChange={(e) => setMaxEventLen(Number(e.target.value))}
                className="text-xs h-8"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="max-pm" className="text-xs">Max param key length</Label>
              <Input
                id="max-pm"
                type="number"
                min={10}
                max={100}
                value={maxParamLen}
                onChange={(e) => setMaxParamLen(Number(e.target.value))}
                className="text-xs h-8"
              />
            </div>
          </div>

          {/* Reserved words */}
          <div className="space-y-1">
            <Label htmlFor="reserved" className="text-xs">
              Reserved words{' '}
              <span className="text-muted-foreground">(comma-separated — these names are blocked)</span>
            </Label>
            <Input
              id="reserved"
              placeholder="event, page_view, session_start"
              value={reservedWords}
              onChange={(e) => setReservedWords(e.target.value)}
              className="font-mono text-xs h-8"
            />
          </div>

          {/* Live example preview */}
          <div className="rounded-lg bg-[#F3F4F6] px-4 py-3 space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF]">
              Live preview
            </p>
            <div className="flex items-center gap-4 flex-wrap">
              <div>
                <p className="text-[10px] text-[#9CA3AF]">Event</p>
                <code className="text-xs font-mono text-[#1B2A4A]">
                  {(eventPrefix.trim() || '') + formatExample('add_to_cart', eventCase)}
                </code>
              </div>
              <div>
                <p className="text-[10px] text-[#9CA3AF]">Param</p>
                <code className="text-xs font-mono text-[#1B2A4A]">
                  {(paramPrefix.trim() || '') + formatExample('transaction_id', paramCase)}
                </code>
              </div>
            </div>
          </div>

          {/* Preview renames */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium">Impact on existing signals</p>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5"
                onClick={loadPreview}
                disabled={isLoadingPreview}
              >
                <RefreshCw className={`h-3 w-3 ${isLoadingPreview ? 'animate-spin' : ''}`} />
                {isLoadingPreview ? 'Loading…' : 'Preview renames'}
              </Button>
            </div>

            {applyResult && (
              <p className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-700">
                ✓ {applyResult.renamed_count} signal{applyResult.renamed_count !== 1 ? 's' : ''} renamed and convention saved.
              </p>
            )}

            {preview && (
              <div className="rounded-lg border border-[#E5E7EB] overflow-hidden text-xs">
                <div className="bg-[#FAFAFA] px-3 py-1.5 border-b border-[#E5E7EB] text-[#6B7280]">
                  {preview.renames.length} of {preview.total_signals} signals would be renamed
                </div>
                {preview.renames.length > 0 ? (
                  <>
                    <div className="divide-y divide-[#F3F4F6] max-h-40 overflow-y-auto">
                      {preview.renames.map((r) => (
                        <div key={r.signal_id} className="flex items-center gap-3 px-3 py-1.5">
                          <code className="text-[#9CA3AF] line-through">{r.current}</code>
                          <span className="text-[#D1D5DB]">→</span>
                          <code className="text-[#059669]">{r.suggested}</code>
                        </div>
                      ))}
                    </div>
                    <div className="border-t border-[#E5E7EB] px-3 py-2">
                      <Button
                        size="sm"
                        className="h-7 text-xs bg-[#1B2A4A] hover:bg-[#1B2A4A]"
                        onClick={handleApply}
                        disabled={isApplying}
                      >
                        {isApplying ? 'Applying…' : `Apply ${preview.renames.length} rename${preview.renames.length !== 1 ? 's' : ''}`}
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="px-3 py-2 text-[#6B7280]">No signals would be renamed.</p>
                )}
              </div>
            )}
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 rounded px-3 py-2">{error}</p>
          )}

          <div className="flex justify-between pt-1">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Saving…' : 'Save convention'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Client-side preview of case conversion (mirrors backend logic)
function formatExample(slug: string, format: CaseFormat): string {
  const words = slug.split('_').filter(Boolean);
  switch (format) {
    case 'snake_case':  return words.join('_');
    case 'camelCase':   return words[0] + words.slice(1).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
    case 'kebab-case':  return words.join('-');
    case 'PascalCase':  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  }
}
