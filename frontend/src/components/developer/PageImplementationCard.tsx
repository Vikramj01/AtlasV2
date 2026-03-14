import { useState } from 'react';
import { cn } from '@/lib/utils';
import { CodeSnippet } from './CodeSnippet';
import type { DevPortalPage, ImplementationStatus, QuickCheckResult } from '@/types/planning';

const STATUS_OPTIONS: { value: ImplementationStatus; label: string }[] = [
  { value: 'not_started', label: 'Not Started' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'implemented', label: 'Implemented' },
  { value: 'verified',    label: 'Verified' },
];

const STATUS_STYLES: Record<ImplementationStatus, string> = {
  not_started: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-blue-100 text-blue-700',
  implemented: 'bg-amber-100 text-amber-700',
  verified:    'bg-green-100 text-green-700',
};

const STATUS_ICONS: Record<ImplementationStatus, string> = {
  not_started: '○',
  in_progress: '◌',
  implemented: '◉',
  verified:    '✓',
};

// ── Quick Check Result display ────────────────────────────────────────────────

function QuickCheckResultPanel({ result }: { result: QuickCheckResult }) {
  const { overall_status, summary, tracking } = result;

  const panelStyle =
    overall_status === 'tracking_found'
      ? 'border-green-200 bg-green-50'
      : overall_status === 'partial'
        ? 'border-amber-200 bg-amber-50'
        : 'border-red-200 bg-red-50';

  const iconAndLabel =
    overall_status === 'tracking_found'
      ? { icon: '✓', label: 'Implementation verified', color: 'text-green-700' }
      : overall_status === 'partial'
        ? { icon: '⚠', label: 'Pre-existing tracking only', color: 'text-amber-700' }
        : { icon: '✗', label: 'No tracking detected', color: 'text-red-700' };

  return (
    <div className={`rounded-lg border px-4 py-3 ${panelStyle}`}>
      <div className="flex items-center justify-between mb-1.5">
        <span className={`text-sm font-semibold ${iconAndLabel.color}`}>
          {iconAndLabel.icon} {iconAndLabel.label}
        </span>
        <span className="text-xs text-muted-foreground/60">
          {result.duration_ms < 1000 ? `${result.duration_ms}ms` : `${(result.duration_ms / 1000).toFixed(1)}s`}
        </span>
      </div>
      <p className="text-xs text-muted-foreground mb-2">{summary}</p>
      {tracking.datalayer_events.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tracking.datalayer_events.map((event) => (
            <span key={event} className="rounded bg-white/70 border border-current/20 px-1.5 py-0.5 text-xs font-mono">
              {event}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main card ─────────────────────────────────────────────────────────────────

interface PageImplementationCardProps {
  shareToken: string;
  page: DevPortalPage;
  onStatusChange: (pageId: string, status: ImplementationStatus, notes?: string) => Promise<void>;
  onQuickCheck: (shareToken: string, pageId: string) => Promise<QuickCheckResult>;
}

export function PageImplementationCard({
  shareToken,
  page,
  onStatusChange,
  onQuickCheck,
}: PageImplementationCardProps) {
  const [isOpen, setIsOpen] = useState(page.status === 'in_progress');
  const [status, setStatus] = useState<ImplementationStatus>(page.status);
  const [notes, setNotes] = useState(page.developer_notes ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<QuickCheckResult | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);

  async function handleStatusChange(newStatus: ImplementationStatus) {
    setStatus(newStatus);
    setIsSaving(true);
    try {
      await onStatusChange(page.page_id, newStatus, notes || undefined);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleNotesSave() {
    if (notes === (page.developer_notes ?? '')) return;
    setIsSaving(true);
    try {
      await onStatusChange(page.page_id, status, notes || undefined);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleQuickCheck() {
    setIsChecking(true);
    setCheckError(null);
    setCheckResult(null);
    try {
      const result = await onQuickCheck(shareToken, page.page_id);
      setCheckResult(result);
      // Auto-advance to 'verified' if full tracking found and currently implemented
      if (result.overall_status === 'tracking_found' && status === 'implemented') {
        await handleStatusChange('verified');
      }
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : 'Quick check failed');
    } finally {
      setIsChecking(false);
    }
  }

  return (
    <div className={cn(
      'rounded-xl border transition-colors',
      status === 'verified' ? 'border-green-200 bg-green-50/30' :
      status === 'implemented' ? 'border-amber-100 bg-amber-50/20' :
      'border-border bg-background',
    )}>
      {/* Accordion header */}
      <button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className={cn(
            'shrink-0 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold',
            STATUS_STYLES[status],
          )}>
            {STATUS_ICONS[status]}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{page.page_label}</p>
            <p className="text-xs text-muted-foreground truncate">{page.page_url}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0 ml-4">
          {isSaving && (
            <span className="text-xs text-muted-foreground/60">Saving…</span>
          )}
          <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium', STATUS_STYLES[status])}>
            {STATUS_OPTIONS.find((s) => s.value === status)?.label}
          </span>
          <span className={cn('text-xs text-muted-foreground transition-transform', isOpen && 'rotate-180')}>▼</span>
        </div>
      </button>

      {/* Expanded content */}
      {isOpen && (
        <div className="border-t border-border px-5 pb-5 pt-4 space-y-4">
          {/* DataLayer code */}
          {page.datalayer_code ? (
            <CodeSnippet
              code={page.datalayer_code}
              label={`${page.page_label} — dataLayer code`}
            />
          ) : (
            <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              No dataLayer code generated for this page yet.
            </div>
          )}

          {/* Quick Check */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-muted-foreground">Live tracking verification</p>
              <button
                type="button"
                onClick={handleQuickCheck}
                disabled={isChecking}
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                  isChecking
                    ? 'border-border text-muted-foreground cursor-not-allowed'
                    : 'border-brand-300 text-brand-700 hover:bg-brand-50',
                )}
              >
                {isChecking ? (
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-brand-300 border-t-brand-700" />
                    Checking live page…
                  </span>
                ) : (
                  '⚡ Quick Check'
                )}
              </button>
            </div>

            {checkError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {checkError}
              </div>
            )}

            {checkResult && <QuickCheckResultPanel result={checkResult} />}

            {!checkResult && !checkError && !isChecking && (
              <p className="text-xs text-muted-foreground/50">
                Visits the live page and checks for GTM, GA4, Meta Pixel, and dataLayer events.
              </p>
            )}
          </div>

          {/* Status selector */}
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Implementation status</p>
            <div className="flex flex-wrap gap-2">
              {STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleStatusChange(opt.value)}
                  disabled={isSaving}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                    status === opt.value
                      ? cn(STATUS_STYLES[opt.value], 'border-transparent ring-1 ring-offset-1',
                          opt.value === 'verified' ? 'ring-green-400' :
                          opt.value === 'implemented' ? 'ring-amber-400' :
                          opt.value === 'in_progress' ? 'ring-blue-400' : 'ring-gray-400')
                      : 'border-border text-muted-foreground hover:bg-muted/40',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Developer notes */}
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Notes (optional)</p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={handleNotesSave}
              rows={2}
              placeholder="e.g. Added dataLayer push in checkout-success.js on line 42"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-brand-500 resize-none"
            />
          </div>
        </div>
      )}
    </div>
  );
}
