import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { usePlanningStore } from '@/store/planningStore';
import { planningApi } from '@/lib/api/planningApi';
import { AnnotatedScreenshot } from './AnnotatedScreenshot';
import { RecommendationCard } from './RecommendationCard';
import { CustomElementForm } from './CustomElementForm';
import type { PlanningPage, PlanningRecommendation } from '@/types/planning';

export function Step4ReviewRecommendations() {
  const {
    currentSession, pages, recommendations, setRecommendations,
    nextStep, setLoading, isLoading, error, setError,
  } = usePlanningStore();

  const sessionId = currentSession?.id ?? '';

  const [screenshotUrls, setScreenshotUrls] = useState<Record<string, string>>({});
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [selectedRecId, setSelectedRecId] = useState<string | null>(null);
  const [showCustomForm, setShowCustomForm] = useState(false);

  useEffect(() => {
    if (recommendations.length > 0 || !sessionId) return;
    setLoading(true);
    planningApi
      .getRecommendations(sessionId)
      .then(({ recommendations: recs }) => setRecommendations(recs))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activePageId) return;
    const pagesWithRecs = pages.filter((p) => recommendations.some((r) => r.page_id === p.id));
    if (pagesWithRecs.length > 0) setActivePageId(pagesWithRecs[0].id);
  }, [pages, recommendations, activePageId]);

  useEffect(() => {
    if (!activePageId || screenshotUrls[activePageId] || !sessionId) return;
    planningApi
      .getScreenshotUrl(sessionId, activePageId)
      .then(({ url }) => setScreenshotUrls((prev) => ({ ...prev, [activePageId]: url })))
      .catch(() => {});
  }, [activePageId, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const pagesWithRecs: PlanningPage[] = pages.filter((p) => recommendations.some((r) => r.page_id === p.id));
  const activePageRecs: PlanningRecommendation[] = recommendations.filter((r) => r.page_id === activePageId);

  const totalRecs = recommendations.length;
  const decidedRecs = recommendations.filter((r) => r.user_decision !== null).length;
  const approvedRecs = recommendations.filter((r) => r.user_decision === 'approved' || r.user_decision === 'modified').length;
  const canContinue = approvedRecs > 0;

  function approveHighConfidence() {
    const toApprove = recommendations.filter((r) => r.confidence_score >= 0.8 && !r.user_decision);
    toApprove.forEach((r) => {
      planningApi.updateDecision(sessionId, r.id, 'approved').catch(() => {});
    });
    setRecommendations(
      recommendations.map((r) =>
        r.confidence_score >= 0.8 && !r.user_decision
          ? { ...r, user_decision: 'approved' as const, decided_at: new Date().toISOString() }
          : r,
      ),
    );
  }

  const highConfidenceUndecided = recommendations.filter((r) => r.confidence_score >= 0.8 && !r.user_decision).length;

  if (isLoading) {
    return <div className="flex items-center justify-center py-32 text-sm text-muted-foreground">Loading recommendations…</div>;
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-10">
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-4 text-sm text-destructive">
          <p className="font-medium">Failed to load recommendations</p>
          <p className="mt-0.5">{error}</p>
          <Button
            size="sm"
            onClick={() => {
              setError(null);
              setLoading(true);
              planningApi.getRecommendations(sessionId)
                .then(({ recommendations: recs }) => setRecommendations(recs))
                .catch((err) => setError(err.message))
                .finally(() => setLoading(false));
            }}
            className="mt-3 bg-destructive hover:bg-destructive/90"
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (pagesWithRecs.length === 0) {
    const fallbackPageId = pages[0]?.id ?? null;
    return (
      <div className="mx-auto max-w-xl px-6 py-20 text-center">
        <p className="text-lg font-medium">No recommendations found</p>
        <p className="mt-1 text-sm text-muted-foreground">
          The AI didn't identify any tracking elements. You can add elements manually or go back and rescan.
        </p>
        <Button
          onClick={() => { if (fallbackPageId) setActivePageId(fallbackPageId); setShowCustomForm(true); }}
          className="mt-4 bg-brand-600 hover:bg-brand-700"
        >
          + Add Custom Element
        </Button>
        {showCustomForm && fallbackPageId && (
          <CustomElementForm sessionId={sessionId} pageId={fallbackPageId} onClose={() => setShowCustomForm(false)} />
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-background px-6 py-3">
        <div className="flex gap-1 overflow-x-auto">
          {pagesWithRecs.map((page) => {
            const pageRecs = recommendations.filter((r) => r.page_id === page.id);
            const pageDecided = pageRecs.filter((r) => r.user_decision).length;
            return (
              <button
                key={page.id}
                onClick={() => { setActivePageId(page.id); setSelectedRecId(null); }}
                className={cn(
                  'flex-shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                  page.id === activePageId
                    ? 'bg-brand-600 text-white'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                )}
              >
                {page.page_title ?? new URL(page.url).pathname}{' '}
                <span className="opacity-70">({pageDecided}/{pageRecs.length})</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          {highConfidenceUndecided > 0 && (
            <Button
              size="sm"
              onClick={approveHighConfidence}
              className="border-green-300 bg-green-50 text-green-700 hover:bg-green-100 h-7 text-xs"
              variant="outline"
            >
              ✓ Approve {highConfidenceUndecided} high-confidence
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowCustomForm(true)}
            className="h-7 text-xs"
          >
            + Custom element
          </Button>
        </div>
      </div>

      {/* Main 2-column layout */}
      <div className="flex flex-1 overflow-hidden">
        <div className="hidden w-1/2 overflow-y-auto border-r bg-muted/20 p-4 lg:block">
          <AnnotatedScreenshot
            screenshotUrl={screenshotUrls[activePageId ?? ''] ?? null}
            recommendations={activePageRecs}
            selectedId={selectedRecId}
            onSelect={setSelectedRecId}
          />
        </div>

        <div className="flex w-full flex-col lg:w-1/2">
          <div className="flex-1 space-y-2 overflow-y-auto p-4">
            {activePageRecs.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No recommendations for this page.</p>
            ) : (
              activePageRecs.map((rec, idx) => (
                <RecommendationCard
                  key={rec.id}
                  rec={rec}
                  index={idx}
                  sessionId={sessionId}
                  isSelected={rec.id === selectedRecId}
                  onSelect={() => setSelectedRecId(rec.id)}
                />
              ))
            )}
          </div>

          <div className="border-t bg-background px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {decidedRecs} of {totalRecs} reviewed · {approvedRecs} approved
              </span>
              <Button
                onClick={nextStep}
                disabled={!canContinue}
                className="bg-brand-600 hover:bg-brand-700"
                title={canContinue ? undefined : 'Approve at least one recommendation to continue'}
              >
                Continue to Summary →
              </Button>
            </div>

            <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-brand-400 transition-all duration-300"
                style={{ width: totalRecs > 0 ? `${(approvedRecs / totalRecs) * 100}%` : '0%' }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-700 lg:hidden">
        For the best experience, use a desktop browser (≥1024px) to see annotated screenshots.
      </div>

      {showCustomForm && activePageId && (
        <CustomElementForm sessionId={sessionId} pageId={activePageId} onClose={() => setShowCustomForm(false)} />
      )}
    </div>
  );
}
