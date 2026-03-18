import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usePlanningStore } from '@/store/planningStore';
import { planningApi } from '@/lib/api/planningApi';
import { GTMContainerPreview } from './GTMContainerPreview';
import { WalkerOSAdvantageCard } from '@/components/signals/WalkerOSAdvantageCard';
import { SignalComparison } from './SignalComparison';
import type { PlanningOutput, OutputType, ExistingTrackingQuick } from '@/types/planning';

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

// ── Platform IDs form ─────────────────────────────────────────────────────────

interface PlatformIds {
  ga4: string;
  google_ads: string;
  meta_pixel: string;
}

function PlatformIdsForm({
  ids,
  onChange,
}: {
  ids: PlatformIds;
  onChange: (ids: PlatformIds) => void;
}) {
  return (
    <div className="mt-4 rounded-lg border border-border bg-muted/20 p-4">
      <p className="mb-3 text-sm font-medium">
        Replace placeholder IDs before downloading{' '}
        <span className="text-xs font-normal text-muted-foreground">(optional but recommended)</span>
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="ga4-id" className="text-xs">GA4 Measurement ID</Label>
          <Input
            id="ga4-id"
            type="text"
            placeholder="G-XXXXXXXXXX"
            value={ids.ga4}
            onChange={(e) => onChange({ ...ids, ga4: e.target.value })}
            className="h-8 text-xs font-mono"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ads-id" className="text-xs">Google Ads Conversion ID</Label>
          <Input
            id="ads-id"
            type="text"
            placeholder="AW-XXXXXXXXXX/YYYY"
            value={ids.google_ads}
            onChange={(e) => onChange({ ...ids, google_ads: e.target.value })}
            className="h-8 text-xs font-mono"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="meta-id" className="text-xs">Meta Pixel ID</Label>
          <Input
            id="meta-id"
            type="text"
            placeholder="1234567890"
            value={ids.meta_pixel}
            onChange={(e) => onChange({ ...ids, meta_pixel: e.target.value })}
            className="h-8 text-xs font-mono"
          />
        </div>
      </div>
    </div>
  );
}

// ── Replace placeholder IDs in GTM JSON string ────────────────────────────────

function injectPlatformIds(jsonStr: string, ids: PlatformIds): string {
  let result = jsonStr;
  if (ids.ga4.trim()) {
    result = result.replace(/G-XXXXXXXXX[X]*/g, ids.ga4.trim());
  }
  if (ids.google_ads.trim()) {
    result = result.replace(/AW-XXXXXXXXX[X]*\/[Y]*/g, ids.google_ads.trim());
    result = result.replace(/AW-XXXXXXXXX[X]*/g, ids.google_ads.trim().split('/')[0]);
  }
  if (ids.meta_pixel.trim()) {
    // Replace placeholder numeric pixel IDs (10+ zeros or placeholder patterns)
    result = result.replace(/\b(0{10,}|1234567890)\b/g, ids.meta_pixel.trim());
  }
  return result;
}

// ── Preview modal ─────────────────────────────────────────────────────────────

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

// ── GTM Output card (with inline preview) ─────────────────────────────────────

function GTMOutputCard({
  output,
  sessionId,
  existingTracking,
}: {
  output: PlanningOutput;
  sessionId: string;
  existingTracking: ExistingTrackingQuick | null;
}) {
  const meta = OUTPUT_META.gtm_container;
  const [isDownloading, setIsDownloading] = useState(false);
  const [showRawPreview, setShowRawPreview] = useState(false);
  const [platformIds, setPlatformIds] = useState<PlatformIds>({ ga4: '', google_ads: '', meta_pixel: '' });
  const [previewExpanded, setPreviewExpanded] = useState(true);

  const sizeLabel = output.file_size_bytes
    ? output.file_size_bytes > 1024
      ? `${(output.file_size_bytes / 1024).toFixed(1)} KB`
      : `${output.file_size_bytes} B`
    : null;

  const containerContent = output.content as Record<string, unknown> | null;

  async function handleDownload() {
    setIsDownloading(true);
    try {
      let jsonStr: string;
      if (containerContent) {
        jsonStr = JSON.stringify(containerContent, null, 2);
      } else {
        const blob = await planningApi.downloadOutput(sessionId, output.id);
        jsonStr = await blob.text();
      }

      const hasAnyId = platformIds.ga4.trim() || platformIds.google_ads.trim() || platformIds.meta_pixel.trim();
      if (hasAnyId) {
        jsonStr = injectPlatformIds(jsonStr, platformIds);
      }

      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'atlas-gtm-container.json';
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
        <CardContent className="p-5">
          {/* Header row */}
          <div className="flex items-start gap-4 mb-4">
            <div className="mt-0.5 text-3xl">{meta.icon}</div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold">{meta.title}</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">{meta.description}</p>
              {sizeLabel && <p className="mt-1 text-xs text-muted-foreground/70">{sizeLabel}</p>}
            </div>
            <div className="flex shrink-0 flex-col gap-2 items-end">
              {containerContent && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPreviewExpanded((p) => !p)}
                  className="text-xs"
                >
                  {previewExpanded ? 'Collapse preview' : 'Show preview'}
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowRawPreview(true)}
                className="text-xs"
              >
                View raw JSON
              </Button>
            </div>
          </div>

          {/* GTM Preview tree */}
          {containerContent && previewExpanded && (
            <div className="mb-4">
              <GTMContainerPreview
                containerJson={containerContent}
                existingTracking={existingTracking ?? null}
              />
            </div>
          )}

          {/* Platform IDs form */}
          <PlatformIdsForm ids={platformIds} onChange={setPlatformIds} />

          {/* Download button */}
          <div className="mt-4 flex justify-end">
            <Button
              size="sm"
              onClick={handleDownload}
              disabled={isDownloading}
              className="bg-brand-600 hover:bg-brand-700 text-xs"
            >
              {isDownloading ? 'Downloading…' : 'Download .json'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {showRawPreview && <PreviewModal output={output} onClose={() => setShowRawPreview(false)} />}
    </>
  );
}

// ── Standard output card (non-GTM) ────────────────────────────────────────────

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
      blob = await planningApi.downloadOutput(sessionId, output.id);
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
          <div className="flex shrink-0 gap-2">
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

// ── Main step component ───────────────────────────────────────────────────────

export function Step6GeneratedOutputs() {
  const { currentSession, outputs, setOutputs, recommendations, nextStep, prevStep, siteDetection } = usePlanningStore();
  const sessionId = currentSession?.id ?? '';
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'outputs' | 'signal_map'>('outputs');

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

  const approvedRecs = recommendations.filter(
    (r) => r.user_decision === 'approved' || r.user_decision === 'edited'
  );

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-2xl">🎉</span>
        <h2 className="text-xl font-bold">Your implementation files are ready</h2>
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        Preview or download each file below. Share them with your developer to implement tracking.
      </p>

      {/* Tab navigation */}
      <div className="mb-6 flex border-b">
        <button
          type="button"
          onClick={() => setActiveTab('outputs')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'outputs'
              ? 'border-brand-500 text-brand-700'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Implementation Files
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('signal_map')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'signal_map'
              ? 'border-brand-500 text-brand-700'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Signal Map
        </button>
      </div>

      {activeTab === 'signal_map' && (
        <div className="mb-8">
          <SignalComparison
            recommendations={approvedRecs}
            selectedPlatforms={currentSession?.selected_platforms ?? []}
          />
        </div>
      )}

      {activeTab === 'outputs' && <div className="mb-8 space-y-4">
        {sortedOutputs.map((output) =>
          output.output_type === 'gtm_container' ? (
            <GTMOutputCard
              key={output.id}
              output={output}
              sessionId={sessionId}
              existingTracking={siteDetection?.existing_tracking ?? null}
            />
          ) : (
            <OutputCard key={output.id} output={output} sessionId={sessionId} />
          ),
        )}
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
      </div>}

      {activeTab === 'outputs' && <div className="mb-8">
        <WalkerOSAdvantageCard context="output" />
      </div>}

      {activeTab === 'outputs' && <div className="mb-8 rounded-xl border border-amber-100 bg-amber-50 p-5">
        <h3 className="mb-2 text-sm font-bold text-amber-800">How to import the GTM container</h3>
        <ol className="list-inside list-decimal space-y-1 text-xs text-amber-700">
          <li>Paste your platform IDs above, then download the GTM Container JSON file.</li>
          <li>Open <strong>Google Tag Manager</strong> → Admin → Import Container.</li>
          <li>Select the downloaded file, choose your workspace, and import.</li>
          <li>Choose <strong>Merge → Rename conflicting</strong> to avoid overwriting existing tags.</li>
          <li>Preview and test in GTM Preview Mode before publishing.</li>
        </ol>
      </div>}

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={prevStep} className="text-muted-foreground">← Back</Button>
        <Button onClick={nextStep} className="bg-brand-600 hover:bg-brand-700">
          Next: Handoff to Audit Mode →
        </Button>
      </div>
    </div>
  );
}
