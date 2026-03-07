import { useState } from 'react';
import { usePlanningStore } from '@/store/planningStore';
import { planningApi } from '@/lib/api/planningApi';
import type { PlanningOutput, OutputType } from '@/types/planning';

// ── Output card metadata ───────────────────────────────────────────────────────

const OUTPUT_META: Record<OutputType, { title: string; description: string; icon: string; ext: string }> = {
  gtm_container: {
    title:       'GTM Container JSON',
    description: 'Import directly into Google Tag Manager. Contains all tags, triggers, and variables.',
    icon:        '📦',
    ext:         'json',
  },
  datalayer_spec: {
    title:       'DataLayer Specification',
    description: 'Per-page dataLayer.push() code snippets for your developer.',
    icon:        '💻',
    ext:         'json',
  },
  implementation_guide: {
    title:       'Implementation Guide',
    description: 'Human-readable HTML guide with setup instructions, platform IDs, and a testing checklist.',
    icon:        '📄',
    ext:         'html',
  },
};

// ── Preview modal ─────────────────────────────────────────────────────────────

function PreviewModal({
  output,
  onClose,
}: {
  output: PlanningOutput;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h3 className="text-base font-bold text-gray-900">
            {OUTPUT_META[output.output_type].title} — Preview
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            aria-label="Close preview"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {output.output_type === 'implementation_guide' && output.content_text ? (
            <iframe
              srcDoc={output.content_text}
              title="Implementation Guide Preview"
              sandbox="allow-same-origin"
              className="h-full w-full border-none"
            />
          ) : output.content ? (
            <pre className="h-full overflow-auto p-5 font-mono text-xs leading-relaxed text-gray-700">
              {JSON.stringify(output.content, null, 2)}
            </pre>
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-gray-400">
              Preview not available
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Output card ───────────────────────────────────────────────────────────────

function OutputCard({
  output,
  sessionId,
}: {
  output: PlanningOutput;
  sessionId: string;
}) {
  const meta = OUTPUT_META[output.output_type];
  const [isDownloading, setIsDownloading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Check if preview is available
  const hasPreview = output.content !== null || output.content_text !== null;

  // Size formatting
  const sizeLabel = output.file_size_bytes
    ? output.file_size_bytes > 1024
      ? `${(output.file_size_bytes / 1024).toFixed(1)} KB`
      : `${output.file_size_bytes} B`
    : null;

  async function handleDownload() {
    setIsDownloading(true);
    try {
      let blob: Blob;

      // If we have a direct download URL, use it
      if (output.download_url) {
        const res = await fetch(output.download_url);
        blob = await res.blob();
      } else {
        blob = await planningApi.downloadOutput(sessionId, output.id);
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `atlas-${output.output_type}.${meta.ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download failed:', err);
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <>
      <div className="flex items-start gap-4 rounded-xl border border-gray-100 bg-white p-5">
        <div className="mt-0.5 text-3xl">{meta.icon}</div>

        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-gray-900">{meta.title}</h3>
          <p className="mt-0.5 text-xs text-gray-500">{meta.description}</p>
          {sizeLabel && (
            <p className="mt-1 text-xs text-gray-400">{sizeLabel}</p>
          )}
        </div>

        <div className="flex flex-shrink-0 gap-2">
          {hasPreview && (
            <button
              onClick={() => setShowPreview(true)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
            >
              Preview
            </button>
          )}
          <button
            onClick={handleDownload}
            disabled={isDownloading}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {isDownloading ? 'Downloading…' : `Download .${meta.ext}`}
          </button>
        </div>
      </div>

      {showPreview && (
        <PreviewModal output={output} onClose={() => setShowPreview(false)} />
      )}
    </>
  );
}

// ── Main step component ────────────────────────────────────────────────────────

export function Step6GeneratedOutputs() {
  const { currentSession, outputs, setOutputs, nextStep, prevStep } = usePlanningStore();
  const sessionId = currentSession?.id ?? '';
  const [isRefreshing, setIsRefreshing] = useState(false);

  async function refreshOutputs() {
    if (!sessionId) return;
    setIsRefreshing(true);
    try {
      const { outputs: fresh } = await planningApi.listOutputs(sessionId);
      setOutputs(fresh as Parameters<typeof setOutputs>[0]);
    } catch {
      // non-fatal — user can retry
    } finally {
      setIsRefreshing(false);
    }
  }

  // Sort outputs in canonical order
  const ORDER: OutputType[] = ['gtm_container', 'datalayer_spec', 'implementation_guide'];
  const sortedOutputs = [...outputs].sort(
    (a, b) => ORDER.indexOf(a.output_type) - ORDER.indexOf(b.output_type),
  );

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-2xl">🎉</span>
        <h2 className="text-xl font-bold text-gray-900">Your implementation files are ready</h2>
      </div>
      <p className="mb-8 text-sm text-gray-500">
        Preview or download each file below. Share them with your developer to implement tracking.
      </p>

      {/* Output cards */}
      <div className="mb-8 space-y-3">
        {sortedOutputs.map((output) => (
          <OutputCard key={output.id} output={output} sessionId={sessionId} />
        ))}
        {outputs.length === 0 && (
          <div className="py-10 text-center">
            <div className="mb-3 inline-block h-6 w-6 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
            <p className="text-sm text-gray-500">Outputs are still being generated…</p>
            <button
              onClick={refreshOutputs}
              disabled={isRefreshing}
              className="mt-3 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
            >
              {isRefreshing ? 'Checking…' : 'Check again'}
            </button>
          </div>
        )}
      </div>

      {/* GTM import instructions */}
      <div className="mb-8 rounded-xl border border-amber-100 bg-amber-50 p-5">
        <h3 className="mb-2 text-sm font-bold text-amber-800">How to import the GTM container</h3>
        <ol className="list-inside list-decimal space-y-1 text-xs text-amber-700">
          <li>Download the GTM Container JSON file above.</li>
          <li>Open <strong>Google Tag Manager</strong> → Admin → Import Container.</li>
          <li>Select the downloaded file, choose your workspace, and import.</li>
          <li>Replace placeholder IDs (GA4 Measurement ID, Google Ads Conversion ID, etc.) in the imported variables.</li>
          <li>Preview and test in GTM Preview Mode before publishing.</li>
        </ol>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button onClick={prevStep} className="text-sm text-gray-400 hover:text-gray-600">
          ← Back
        </button>
        <button
          onClick={nextStep}
          className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
        >
          Next: Handoff to Audit Mode →
        </button>
      </div>
    </div>
  );
}
