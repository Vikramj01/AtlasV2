import { useState } from 'react';
import { usePlanningStore } from '@/store/planningStore';
import { planningApi } from '@/lib/api/planningApi';
import type { Platform } from '@/types/planning';

const PLATFORM_LABELS: Record<Platform, string> = {
  ga4:        'Google Analytics 4',
  google_ads: 'Google Ads',
  meta:       'Meta (Facebook/Instagram)',
  tiktok:     'TikTok Ads',
  sgtm:       'Server-side GTM',
};

const PLATFORM_ICONS: Record<Platform, string> = {
  ga4:        '📊',
  google_ads: '🎯',
  meta:       '📘',
  tiktok:     '🎵',
  sgtm:       '🖥️',
};

export function Step5TrackingPlanSummary() {
  const {
    currentSession,
    recommendations,
    pages,
    setOutputs,
    nextStep,
    prevStep,
  } = usePlanningStore();

  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sessionId = currentSession?.id ?? '';
  const platforms = currentSession?.selected_platforms ?? [];

  const approved = recommendations.filter((r) => r.user_decision === 'approved' || r.user_decision === 'edited');
  const skipped  = recommendations.filter((r) => r.user_decision === 'skipped');

  // Group approved recs by page URL for summary list
  const byPage = approved.reduce<Record<string, string[]>>((acc, rec) => {
    const page = pages.find((p) => p.id === rec.page_id);
    const pageLabel = page?.page_title ?? page?.url ?? rec.page_id;
    if (!acc[pageLabel]) acc[pageLabel] = [];
    acc[pageLabel].push(rec.event_name);
    return acc;
  }, {});

  // Rough effort estimate: 0.5 hr per event
  const estimatedHours = Math.max(1, Math.ceil(approved.length * 0.5));

  async function handleGenerate() {
    setIsGenerating(true);
    setError(null);
    try {
      const result = await planningApi.generateOutputs(sessionId);
      setOutputs(
        result.outputs.map((o) => ({
          id: o.id,
          session_id: sessionId,
          output_type: o.type,
          content: null,
          content_text: null,
          storage_path: null,
          file_size_bytes: null,
          mime_type: o.mime_type,
          generated_at: o.generated_at,
          version: o.version,
          download_url: o.download_url ?? undefined,
        })),
      );
      nextStep(); // → Step 6
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <h2 className="mb-1 text-xl font-bold text-gray-900">Tracking Plan Summary</h2>
      <p className="mb-8 text-sm text-gray-500">
        Review your plan before Atlas generates the GTM container and implementation files.
      </p>

      {/* Platforms */}
      <section className="mb-6 rounded-xl border border-gray-100 bg-white p-5">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
          Platforms
        </h3>
        <div className="flex flex-wrap gap-2">
          {platforms.map((p) => (
            <span
              key={p}
              className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm font-medium text-gray-700"
            >
              <span>{PLATFORM_ICONS[p]}</span>
              {PLATFORM_LABELS[p]}
            </span>
          ))}
        </div>
      </section>

      {/* Events being captured */}
      <section className="mb-6 rounded-xl border border-gray-100 bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            Events to capture ({approved.length})
          </h3>
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
            {approved.length} approved
          </span>
        </div>

        {approved.length === 0 ? (
          <p className="text-sm text-gray-400">No events approved. Go back and approve at least one.</p>
        ) : (
          <div className="space-y-3">
            {Object.entries(byPage).map(([pageLabel, events]) => (
              <div key={pageLabel}>
                <p className="mb-1 text-xs font-medium text-gray-500 truncate">{pageLabel}</p>
                <div className="flex flex-wrap gap-1.5">
                  {events.map((ev) => (
                    <span
                      key={ev}
                      className="rounded bg-brand-50 px-2 py-0.5 font-mono text-xs text-brand-700"
                    >
                      {ev}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Skipped items */}
      {skipped.length > 0 && (
        <section className="mb-6 rounded-xl border border-gray-100 bg-white p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Skipped ({skipped.length})
            </h3>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {skipped.map((r) => (
              <span
                key={r.id}
                className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-500 line-through"
              >
                {r.event_name}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Estimated effort */}
      <section className="mb-8 rounded-xl border border-gray-100 bg-white p-5">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
          Estimated implementation effort
        </h3>
        <div className="flex items-center gap-3">
          <span className="text-3xl font-bold text-gray-900">{estimatedHours}h</span>
          <div>
            <p className="text-sm text-gray-600">
              ~{approved.length} dataLayer.push() calls across {Object.keys(byPage).length} page
              {Object.keys(byPage).length !== 1 ? 's' : ''}
            </p>
            <p className="text-xs text-gray-400">
              Based on 30 min per event for a developer familiar with GTM.
            </p>
          </div>
        </div>
      </section>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
          <p className="font-medium">Generation failed</p>
          <p className="mt-0.5 text-red-600">{error}</p>
          <button
            onClick={() => { setError(null); handleGenerate(); }}
            className="mt-3 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between">
        <button
          onClick={prevStep}
          className="text-sm text-gray-400 hover:text-gray-600"
        >
          ← Back
        </button>

        <button
          onClick={handleGenerate}
          disabled={approved.length === 0 || isGenerating}
          className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
        >
          {isGenerating ? (
            <span className="flex items-center gap-2">
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              Generating files…
            </span>
          ) : (
            'Generate Implementation Files →'
          )}
        </button>
      </div>
    </div>
  );
}
