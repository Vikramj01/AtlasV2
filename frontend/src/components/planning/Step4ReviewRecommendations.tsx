import { useEffect, useState } from 'react';
import { usePlanningStore } from '@/store/planningStore';
import { planningApi } from '@/lib/api/planningApi';
import { AnnotatedScreenshot } from './AnnotatedScreenshot';
import { RecommendationCard } from './RecommendationCard';
import { CustomElementForm } from './CustomElementForm';
import type { PlanningPage, PlanningRecommendation } from '@/types/planning';

export function Step4ReviewRecommendations() {
  const {
    currentSession,
    pages,
    recommendations,
    setRecommendations,
    nextStep,
    setLoading,
    isLoading,
    error,
    setError,
  } = usePlanningStore();

  const sessionId = currentSession?.id ?? '';

  // Per-page screenshot signed URLs (loaded lazily)
  const [screenshotUrls, setScreenshotUrls] = useState<Record<string, string>>({});

  // Active page tab
  const [activePageId, setActivePageId] = useState<string | null>(null);

  // Selected recommendation (drives screenshot highlight)
  const [selectedRecId, setSelectedRecId] = useState<string | null>(null);

  // Show custom element form
  const [showCustomForm, setShowCustomForm] = useState(false);

  // Load recommendations if not yet loaded
  useEffect(() => {
    if (recommendations.length > 0 || !sessionId) return;
    setLoading(true);
    planningApi
      .getRecommendations(sessionId)
      .then(({ recommendations: recs }) => setRecommendations(recs))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Set initial active page once pages + recs are loaded
  useEffect(() => {
    if (activePageId) return;
    const pagesWithRecs = pages.filter((p) =>
      recommendations.some((r) => r.page_id === p.id),
    );
    if (pagesWithRecs.length > 0) setActivePageId(pagesWithRecs[0].id);
  }, [pages, recommendations, activePageId]);

  // Fetch screenshot signed URL for active page
  useEffect(() => {
    if (!activePageId || screenshotUrls[activePageId] || !sessionId) return;
    planningApi
      .getScreenshotUrl(sessionId, activePageId)
      .then(({ url }) =>
        setScreenshotUrls((prev) => ({ ...prev, [activePageId]: url }))
      )
      .catch(() => {}); // non-fatal
  }, [activePageId, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived ────────────────────────────────────────────────────────────────

  const pagesWithRecs: PlanningPage[] = pages.filter((p) =>
    recommendations.some((r) => r.page_id === p.id),
  );

  const activePageRecs: PlanningRecommendation[] = recommendations.filter(
    (r) => r.page_id === activePageId,
  );

  const totalRecs = recommendations.length;
  const decidedRecs = recommendations.filter((r) => r.user_decision !== null).length;
  const allDecided = decidedRecs === totalRecs && totalRecs > 0;

  // ── Batch approve high-confidence ─────────────────────────────────────────

  function approveHighConfidence() {
    const toApprove = recommendations.filter(
      (r) => r.confidence_score >= 0.8 && !r.user_decision,
    );
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

  const highConfidenceUndecided = recommendations.filter(
    (r) => r.confidence_score >= 0.8 && !r.user_decision,
  ).length;

  // ── Render ─────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-32 text-sm text-gray-400">
        Loading recommendations…
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-10">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
          <p className="font-medium">Failed to load recommendations</p>
          <p className="mt-0.5 text-red-600">{error}</p>
          <button
            onClick={() => {
              setError(null);
              setLoading(true);
              planningApi
                .getRecommendations(sessionId)
                .then(({ recommendations: recs }) => setRecommendations(recs))
                .catch((err) => setError(err.message))
                .finally(() => setLoading(false));
            }}
            className="mt-3 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (pagesWithRecs.length === 0) {
    return (
      <div className="mx-auto max-w-xl px-6 py-20 text-center">
        <p className="text-lg font-medium text-gray-700">No recommendations found</p>
        <p className="mt-1 text-sm text-gray-500">
          The AI didn't identify any tracking elements. You can add elements manually or go back
          and rescan.
        </p>
        <button
          onClick={() => setShowCustomForm(true)}
          className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          + Add Custom Element
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Top bar: page tabs + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 bg-white px-6 py-3">
        {/* Page tabs */}
        <div className="flex gap-1 overflow-x-auto">
          {pagesWithRecs.map((page) => {
            const pageRecs = recommendations.filter((r) => r.page_id === page.id);
            const pageDecided = pageRecs.filter((r) => r.user_decision).length;
            return (
              <button
                key={page.id}
                onClick={() => { setActivePageId(page.id); setSelectedRecId(null); }}
                className={`flex-shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  page.id === activePageId
                    ? 'bg-brand-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {page.page_title ?? new URL(page.url).pathname}
                {' '}
                <span className="opacity-70">
                  ({pageDecided}/{pageRecs.length})
                </span>
              </button>
            );
          })}
        </div>

        {/* Batch approve + add custom */}
        <div className="flex items-center gap-2">
          {highConfidenceUndecided > 0 && (
            <button
              onClick={approveHighConfidence}
              className="rounded-lg border border-green-300 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100"
            >
              ✓ Approve {highConfidenceUndecided} high-confidence
            </button>
          )}
          <button
            onClick={() => setShowCustomForm(true)}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100"
          >
            + Custom element
          </button>
        </div>
      </div>

      {/* Main 2-column layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: annotated screenshot */}
        <div className="hidden w-1/2 overflow-y-auto border-r border-gray-100 bg-gray-50 p-4 lg:block">
          <AnnotatedScreenshot
            screenshotUrl={screenshotUrls[activePageId ?? ''] ?? null}
            recommendations={activePageRecs}
            selectedId={selectedRecId}
            onSelect={setSelectedRecId}
          />
        </div>

        {/* Right: recommendation cards */}
        <div className="flex w-full flex-col lg:w-1/2">
          <div className="flex-1 space-y-2 overflow-y-auto p-4">
            {activePageRecs.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-400">
                No recommendations for this page.
              </p>
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

          {/* Footer: progress + continue */}
          <div className="border-t border-gray-100 bg-white px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">
                {decidedRecs} of {totalRecs} recommendations reviewed
              </span>
              <button
                onClick={nextStep}
                disabled={!allDecided}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
                title={allDecided ? undefined : 'Review all recommendations to continue'}
              >
                Continue to Summary →
              </button>
            </div>

            {/* Mini progress bar */}
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-brand-400 transition-all duration-300"
                style={{ width: totalRecs > 0 ? `${(decidedRecs / totalRecs) * 100}%` : '0%' }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Mobile: no sidebar warning */}
      <div className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-700 lg:hidden">
        For the best experience, use a desktop browser (≥1024px) to see annotated screenshots.
      </div>

      {/* Custom element modal */}
      {showCustomForm && activePageId && (
        <CustomElementForm
          sessionId={sessionId}
          pageId={activePageId}
          onClose={() => setShowCustomForm(false)}
        />
      )}
    </div>
  );
}
