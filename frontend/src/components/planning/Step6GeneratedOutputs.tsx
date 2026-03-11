import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { usePlanningStore } from '@/store/planningStore';
import { planningApi } from '@/lib/api/planningApi';
import type { PlanningOutput, OutputType } from '@/types/planning';

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

function PreviewModal({ output, onClose }: { output: PlanningOutput; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-background shadow-2xl border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h3 className="text-base font-bold">{OUTPUT_META[output.output_type].title} — Preview</h3>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close preview">✕</Button>
        </div>

        <div className="flex-1 overflow-hidden">
          {output.output_type === 'implementation_guide' && output.content_text ? (
            <iframe
              srcDoc={output.content_text}
              title="Implementation Guide Preview"
              sandbox="allow-same-origin"
              className="h-full w-full border-none"
            />
          ) : output.content ? (
            <pre className="h-full overflow-auto p-5 font-mono text-xs leading-relaxed text-muted-foreground">
              {JSON.stringify(output.content, null, 2)}
            </pre>
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              Preview not available
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function OutputCard({ output, sessionId }: { output: PlanningOutput; sessionId: string }) {
  const meta = OUTPUT_META[output.output_type];
  const [isDownloading, setIsDownloading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const hasPreview = output.content !== null || output.content_text !== null;
  const sizeLabel = output.file_size_bytes
    ? output.file_size_bytes > 1024
      ? `${(output.file_size_bytes / 1024).toFixed(1)} KB`
      : `${output.file_size_bytes} B`
    : null;

  async function handleDownload() {
    setIsDownloading(true);
    try {
      let blob: Blob;
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
      <Card>
        <CardContent className="flex items-start gap-4 p-5">
          <div className="mt-0.5 text-3xl">{meta.icon}</div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold">{meta.title}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">{meta.description}</p>
            {sizeLabel && <p className="mt-1 text-xs text-muted-foreground/70">{sizeLabel}</p>}
          </div>
          <div className="flex flex-shrink-0 gap-2">
            {hasPreview && (
              <Button size="sm" variant="outline" onClick={() => setShowPreview(true)} className="text-xs">
                Preview
              </Button>
            )}
            <Button
              size="sm"
              onClick={handleDownload}
              disabled={isDownloading}
              className="bg-brand-600 hover:bg-brand-700 text-xs"
            >
              {isDownloading ? 'Downloading…' : `Download .${meta.ext}`}
            </Button>
          </div>
        </CardContent>
      </Card>

      {showPreview && <PreviewModal output={output} onClose={() => setShowPreview(false)} />}
    </>
  );
}

export function Step6GeneratedOutputs() {
  const { currentSession, outputs, setOutputs, nextStep, prevStep } = usePlanningStore();
  const sessionId = currentSession?.id ?? '';
  const [isRefreshing, setIsRefreshing] = useState(false);

  async function refreshOutputs() {
    if (!sessionId) return;
    setIsRefreshing(true);
    try {
      const { outputs: fresh } = await planningApi.listOutputs(sessionId);
      setOutputs(fresh);
    } catch { /* non-fatal */ }
    finally { setIsRefreshing(false); }
  }

  const ORDER: OutputType[] = ['gtm_container', 'datalayer_spec', 'implementation_guide'];
  const sortedOutputs = [...(outputs ?? [])].sort(
    (a, b) => ORDER.indexOf(a.output_type) - ORDER.indexOf(b.output_type),
  );

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-2xl">🎉</span>
        <h2 className="text-xl font-bold">Your implementation files are ready</h2>
      </div>
      <p className="mb-8 text-sm text-muted-foreground">
        Preview or download each file below. Share them with your developer to implement tracking.
      </p>

      <div className="mb-8 space-y-3">
        {sortedOutputs.map((output) => (
          <OutputCard key={output.id} output={output} sessionId={sessionId} />
        ))}
        {outputs.length === 0 && (
          <div className="py-10 text-center">
            <div className="mb-3 inline-block h-6 w-6 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
            <p className="text-sm text-muted-foreground">Outputs are still being generated…</p>
            <Button
              variant="outline"
              size="sm"
              onClick={refreshOutputs}
              disabled={isRefreshing}
              className="mt-3"
            >
              {isRefreshing ? 'Checking…' : 'Check again'}
            </Button>
          </div>
        )}
      </div>

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

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={prevStep} className="text-muted-foreground">← Back</Button>
        <Button onClick={nextStep} className="bg-brand-600 hover:bg-brand-700">
          Next: Handoff to Audit Mode →
        </Button>
      </div>
    </div>
  );
}
