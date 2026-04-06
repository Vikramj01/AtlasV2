/**
 * ChangeDetectionResults — modal panel showing re-scan diff results.
 *
 * Displayed after a re-scan completes. Shows per-page change type
 * (unchanged / modified / new_elements / removed_elements) and lets the
 * marketer approve new elements directly from the panel.
 */
import { useState } from 'react';
import { planningApi } from '@/lib/api/planningApi';
import type { ChangeDetectionResult, PageChangeResult } from '@/types/planning';

// ── Helpers ───────────────────────────────────────────────────────────────────

const CHANGE_TYPE_CONFIG: Record<
  PageChangeResult['change_type'],
  { label: string; icon: string; border: string; bg: string; text: string }
> = {
  unchanged:       { label: 'Unchanged',         icon: '✓', border: 'border-green-200',  bg: 'bg-green-50',  text: 'text-green-700'  },
  new_elements:    { label: 'New Elements Found', icon: '+', border: 'border-[#1B2A4A]/20',  bg: 'bg-[#EEF1F7]',  text: 'text-[#1B2A4A]'  },
  removed_elements:{ label: 'Elements Removed',  icon: '−', border: 'border-red-200',    bg: 'bg-red-50',    text: 'text-red-700'    },
  modified:        { label: 'Modified',           icon: '~', border: 'border-amber-200',  bg: 'bg-amber-50',  text: 'text-amber-700'  },
  page_not_found:  { label: 'Page Not Found',     icon: '✗', border: 'border-gray-200',   bg: 'bg-gray-50',   text: 'text-gray-600'   },
};

const PRIORITY_CONFIG = {
  must_have:    { label: 'Must Have',    cls: 'bg-red-100 text-red-700'    },
  should_have:  { label: 'Should Have',  cls: 'bg-amber-100 text-amber-700' },
  nice_to_have: { label: 'Nice to Have', cls: 'bg-blue-100 text-blue-700'  },
};

// ── Page change card ──────────────────────────────────────────────────────────

function PageChangeCard({
  page,
  sessionId,
  onNewElementApproved,
}: {
  page: PageChangeResult;
  sessionId: string;
  onNewElementApproved: (pageId: string, eventName: string) => void;
}) {
  const [open, setOpen] = useState(page.change_type !== 'unchanged');
  const [approving, setApproving] = useState<string | null>(null);
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const cfg = CHANGE_TYPE_CONFIG[page.change_type];

  const hasDetail =
    page.new_elements.length > 0 ||
    page.removed_elements.length > 0 ||
    page.modified_elements.length > 0;

  async function handleApprove(eventName: string, selector: string, justification: string) {
    setApproving(eventName);
    try {
      await planningApi.createRecommendation(sessionId, {
        page_id: page.page_id,
        action_type: 'custom_event',
        event_name: eventName,
        element_selector: selector || undefined,
        business_justification: justification,
      });
      setApproved((prev) => new Set([...prev, eventName]));
      onNewElementApproved(page.page_id, eventName);
    } catch {
      // silently ignore — user can retry
    } finally {
      setApproving(null);
    }
  }

  return (
    <div className={`rounded-xl border ${cfg.border} overflow-hidden`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between px-4 py-3 text-left ${cfg.bg}`}
      >
        <div className="flex items-center gap-2">
          <span className={`font-bold ${cfg.text}`}>{cfg.icon}</span>
          <span className={`text-xs font-semibold ${cfg.text}`}>{cfg.label}</span>
          <span className="text-sm font-medium text-foreground truncate max-w-xs">
            {page.page_label}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-3">
          {page.new_elements.length > 0 && (
            <span className="text-xs rounded-full bg-[#EEF1F7] text-[#1B2A4A] px-2 py-0.5">
              {page.new_elements.length} new
            </span>
          )}
          {hasDetail && (
            <span className={`text-xs ${cfg.text} transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
          )}
        </div>
      </button>

      {open && hasDetail && (
        <div className="border-t bg-background px-4 py-4 space-y-4">
          {/* New elements */}
          {page.new_elements.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-[#1B2A4A] mb-2">
                New trackable elements found
              </p>
              <div className="space-y-2">
                {page.new_elements.map((el) => {
                  const isApproved = approved.has(el.event_name);
                  const isApproving = approving === el.event_name;
                  const pri = PRIORITY_CONFIG[el.priority] ?? PRIORITY_CONFIG.should_have;
                  return (
                    <div key={el.event_name} className="rounded-lg border border-[#EEF1F7] bg-[#EEF1F7]/50 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <code className="text-xs font-mono font-bold text-[#1B2A4A]">
                              {el.event_name}
                            </code>
                            <span className={`text-xs rounded-full px-1.5 py-0.5 ${pri.cls}`}>
                              {pri.label}
                            </span>
                          </div>
                          {el.element_text && (
                            <p className="text-xs text-muted-foreground mb-1">
                              Element: &ldquo;{el.element_text}&rdquo;
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground">{el.business_justification}</p>
                        </div>
                        <button
                          type="button"
                          disabled={isApproved || isApproving}
                          onClick={() => handleApprove(el.event_name, el.selector, el.business_justification)}
                          className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                            isApproved
                              ? 'bg-green-100 text-green-700 cursor-default'
                              : 'bg-[#1B2A4A] text-white hover:bg-[#1B2A4A] disabled:opacity-60'
                          }`}
                        >
                          {isApproved ? '✓ Added' : isApproving ? 'Adding…' : 'Add to Plan'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Removed elements */}
          {page.removed_elements.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-red-700 mb-2">
                Elements no longer found on page
              </p>
              <div className="space-y-1.5">
                {page.removed_elements.map((el) => (
                  <div key={el.recommendation_id} className="rounded-lg bg-red-50 border border-red-100 px-3 py-2">
                    <p className="text-xs font-medium text-red-800">
                      <code>{el.original_event_name}</code>
                    </p>
                    <p className="text-xs text-red-700 mt-0.5">{el.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Modified elements */}
          {page.modified_elements.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-amber-700 mb-2">
                Elements changed
              </p>
              <div className="space-y-1.5">
                {page.modified_elements.map((el) => (
                  <div key={el.recommendation_id} className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2">
                    <p className="text-xs font-medium text-amber-800">
                      <code>{el.original_event_name}</code>
                    </p>
                    <p className="text-xs text-amber-700 mt-0.5">{el.change_description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {open && !hasDetail && page.change_type === 'unchanged' && (
        <div className="border-t bg-background px-4 py-3">
          <p className="text-xs text-green-700">All previously approved elements still exist on this page.</p>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface ChangeDetectionResultsProps {
  sessionId: string;
  results: ChangeDetectionResult;
  onClose: () => void;
}

export function ChangeDetectionResults({
  sessionId,
  results,
  onClose,
}: ChangeDetectionResultsProps) {
  const [approvedCount, setApprovedCount] = useState(0);

  function handleNewElementApproved() {
    setApprovedCount((n) => n + 1);
  }

  const { summary } = results;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto">
      <div className="relative w-full max-w-2xl rounded-2xl bg-background shadow-2xl my-8">
        {/* Header */}
        <div className="flex items-start justify-between border-b px-6 py-5">
          <div>
            <h2 className="text-base font-bold text-foreground">Site Change Detection</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Re-scanned {results.pages.length} page{results.pages.length !== 1 ? 's' : ''} ·{' '}
              {results.completed_at
                ? new Date(results.completed_at).toLocaleDateString()
                : 'In progress'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Summary bar */}
        <div className="flex flex-wrap gap-4 border-b px-6 py-4 bg-muted/30">
          <div className="text-center">
            <p className="text-lg font-bold text-foreground">{summary.pages_unchanged}</p>
            <p className="text-xs text-muted-foreground">Unchanged</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-amber-700">{summary.pages_modified}</p>
            <p className="text-xs text-muted-foreground">Modified</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-[#1B2A4A]">{summary.new_elements_found}</p>
            <p className="text-xs text-muted-foreground">New elements</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-red-700">{summary.elements_removed}</p>
            <p className="text-xs text-muted-foreground">Removed</p>
          </div>
          {approvedCount > 0 && (
            <div className="ml-auto text-center">
              <p className="text-lg font-bold text-green-700">{approvedCount}</p>
              <p className="text-xs text-muted-foreground">Added to plan</p>
            </div>
          )}
        </div>

        {/* Action required banner */}
        {summary.action_required && (
          <div className="mx-6 mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-xs font-semibold text-amber-800">Action required</p>
            <p className="text-xs text-amber-700 mt-0.5">
              {summary.elements_removed > 0
                ? 'Some previously tracked elements no longer exist. Review and update your GTM container.'
                : 'New high-priority elements were found. Add them to your plan and regenerate your outputs.'}
            </p>
          </div>
        )}

        {/* Page results */}
        <div className="px-6 py-5 space-y-3">
          {results.pages.map((page) => (
            <PageChangeCard
              key={page.page_id}
              page={page}
              sessionId={sessionId}
              onNewElementApproved={handleNewElementApproved}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="border-t px-6 py-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-[#1B2A4A] px-5 py-2 text-sm font-medium text-white hover:bg-[#1B2A4A] transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
