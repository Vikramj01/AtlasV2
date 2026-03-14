/**
 * Developer Portal Page — /dev/:shareToken
 *
 * Publicly accessible (no auth required). Authenticates via the share token
 * in the URL. No AppLayout, no sidebar, no Zustand store.
 *
 * The developer opens this page, sees page-by-page dataLayer code, and
 * updates implementation status as they work. The marketer can see the
 * same progress from PlanningDashboard.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { developerApi } from '@/lib/api/developerApi';
import { DeveloperHeader } from '@/components/developer/DeveloperHeader';
import { PageImplementationCard } from '@/components/developer/PageImplementationCard';
import type { DevPortalData, ImplementationStatus, QuickCheckResult } from '@/types/planning';

// ── Download helpers ──────────────────────────────────────────────────────────

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Loading / error states ────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center">
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-brand-600" />
        <p className="text-sm text-muted-foreground">Loading implementation guide…</p>
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="max-w-sm text-center">
        <div className="mb-4 text-4xl">🔗</div>
        <h1 className="mb-2 text-lg font-bold">Link unavailable</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function DeveloperPortalPage() {
  const { shareToken } = useParams<{ shareToken: string }>();
  const [data, setData] = useState<DevPortalData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    if (!shareToken) return;
    developerApi
      .getDevPortal(shareToken)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setIsLoading(false));
  }, [shareToken]);

  async function handleStatusChange(
    pageId: string,
    status: ImplementationStatus,
    notes?: string,
  ) {
    if (!shareToken || !data) return;
    await developerApi.updatePageStatus(shareToken, pageId, status, notes);

    // Optimistically update local state
    setData((prev) => {
      if (!prev) return prev;
      const updatedPages = prev.pages.map((p) =>
        p.page_id === pageId
          ? { ...p, status, developer_notes: notes ?? p.developer_notes }
          : p,
      );
      const done = updatedPages.filter(
        (p) => p.status === 'implemented' || p.status === 'verified',
      ).length;
      const counts = { not_started: 0, in_progress: 0, implemented: 0, verified: 0 };
      for (const p of updatedPages) {
        const s = p.status as keyof typeof counts;
        if (s in counts) counts[s]++;
      }
      return {
        ...prev,
        pages: updatedPages,
        progress: {
          ...prev.progress,
          ...counts,
          percent_complete:
            prev.progress.total_pages > 0
              ? Math.round((done / prev.progress.total_pages) * 100)
              : 0,
          all_implemented: done === prev.progress.total_pages && prev.progress.total_pages > 0,
          pages: prev.progress.pages.map((p) =>
            p.page_id === pageId
              ? { ...p, status, developer_notes: notes ?? p.developer_notes }
              : p,
          ),
        },
      };
    });
  }

  async function handleQuickCheck(token: string, pageId: string): Promise<QuickCheckResult> {
    return developerApi.runQuickCheck(token, pageId);
  }

  async function handleDownload(outputId: string, outputType: string, mimeType: string) {
    if (!shareToken) return;
    setDownloadingId(outputId);
    try {
      const blob = await developerApi.downloadOutput(shareToken, outputId);
      const ext = mimeType.includes('html') ? 'html' : 'json';
      triggerDownload(blob, `atlas-${outputType}.${ext}`);
    } catch (err) {
      console.error('Download failed:', err);
    } finally {
      setDownloadingId(null);
    }
  }

  if (isLoading) return <LoadingState />;
  if (error || !data) {
    return (
      <ErrorState
        message={
          error?.includes('401') || error?.includes('Invalid')
            ? 'This link is invalid or has expired. Ask the person who shared it to generate a new link.'
            : (error ?? 'Something went wrong loading this page.')
        }
      />
    );
  }

  const gtmOutput = data.outputs.find((o) => o.output_type === 'gtm_container');
  const specOutput = data.outputs.find((o) => o.output_type === 'datalayer_spec');

  return (
    <div className="min-h-screen bg-background">
      {/* Header with progress bar */}
      <DeveloperHeader
        siteUrl={data.site_url}
        preparedBy={data.prepared_by}
        generatedAt={data.generated_at}
        progress={data.progress}
      />

      <main className="mx-auto max-w-3xl px-6 py-8">
        {/* Download buttons */}
        {data.outputs.length > 0 && (
          <div className="mb-8 flex flex-wrap gap-3">
            {gtmOutput && (
              <button
                type="button"
                onClick={() => handleDownload(gtmOutput.id, gtmOutput.output_type, gtmOutput.mime_type)}
                disabled={downloadingId === gtmOutput.id}
                className="flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-medium shadow-sm hover:bg-muted/40 transition-colors disabled:opacity-60"
              >
                <span>📦</span>
                {downloadingId === gtmOutput.id ? 'Downloading…' : 'Download GTM Container'}
              </button>
            )}
            {specOutput && (
              <button
                type="button"
                onClick={() => handleDownload(specOutput.id, specOutput.output_type, specOutput.mime_type)}
                disabled={downloadingId === specOutput.id}
                className="flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-medium shadow-sm hover:bg-muted/40 transition-colors disabled:opacity-60"
              >
                <span>💻</span>
                {downloadingId === specOutput.id ? 'Downloading…' : 'Download Full Spec'}
              </button>
            )}
          </div>
        )}

        {/* Completion banner */}
        {data.progress.all_implemented && (
          <div className="mb-6 rounded-xl border border-green-200 bg-green-50 px-5 py-4">
            <p className="text-sm font-semibold text-green-800">
              All pages implemented!
            </p>
            <p className="mt-0.5 text-xs text-green-700">
              The marketer has been notified. They can now run an Atlas audit to verify the tracking end-to-end.
            </p>
          </div>
        )}

        {/* Page list */}
        <div className="space-y-3">
          {data.pages.length === 0 && (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No pages found in this implementation guide.
            </div>
          )}
          {data.pages.map((page) => (
            <PageImplementationCard
              key={page.page_id}
              shareToken={shareToken!}
              page={page}
              onStatusChange={handleStatusChange}
              onQuickCheck={handleQuickCheck}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="mt-12 border-t border-border pt-6 text-center">
          <p className="text-xs text-muted-foreground">
            Generated by <span className="font-medium">Atlas</span> · Signal Health Platform
          </p>
        </div>
      </main>
    </div>
  );
}
