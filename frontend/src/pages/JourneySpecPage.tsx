import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { getJourney, getSpec } from '@/lib/api/journeyApi';
import type { JourneyWithDetails } from '@/types/journey';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface SpecData {
  gtm?: unknown;
  walkeros?: unknown;
  validation?: unknown;
}

function CodeBlock({ code, label, filename }: { code: string; label: string; filename?: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function download() {
    const name = filename ?? label.toLowerCase().replace(/\s+/g, '-') + '.txt';
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="rounded-xl border bg-muted/40 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-background">
        <span className="text-xs font-semibold text-muted-foreground">{label}</span>
        <div className="flex gap-3">
          <Button variant="ghost" size="sm" onClick={copy} className="h-auto py-0 px-1 text-xs text-brand-600 hover:text-brand-700">
            {copied ? '✓ Copied' : 'Copy'}
          </Button>
          <Button variant="ghost" size="sm" onClick={download} className="h-auto py-0 px-1 text-xs text-muted-foreground hover:text-foreground">
            Download
          </Button>
        </div>
      </div>
      <pre className="p-4 text-xs text-foreground overflow-x-auto whitespace-pre-wrap max-h-96 leading-relaxed">
        {code}
      </pre>
    </div>
  );
}

function TabExplainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-5 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900 leading-relaxed">
      {children}
    </div>
  );
}

export function JourneySpecPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [details, setDetails] = useState<JourneyWithDetails | null>(null);
  const [specs, setSpecs] = useState<SpecData>({});
  const [activeTab, setActiveTab] = useState<'gtm' | 'walkeros' | 'validation'>('gtm');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);

    Promise.all([
      getJourney(id),
      getSpec(id, 'gtm_datalayer').catch(() => null),
      getSpec(id, 'walkeros_flow').catch(() => null),
      getSpec(id, 'validation_spec').catch(() => null),
    ])
      .then(([journeyDetails, gtmSpec, walkerosSpec, validationSpec]) => {
        setDetails(journeyDetails);
        setSpecs({
          gtm: gtmSpec?.spec_data,
          walkeros: walkerosSpec?.spec_data,
          validation: validationSpec?.spec_data,
        });

        const fmt = journeyDetails.journey.implementation_format;
        if (fmt === 'walkeros') setActiveTab('walkeros');
        else setActiveTab('gtm');
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading implementation spec…</p>
      </div>
    );
  }

  if (error || !details) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20 text-center">
        <div className="mb-4 text-5xl">🔍</div>
        <h2 className="mb-2 text-lg font-bold text-foreground">No audit found</h2>
        <p className="mb-6 text-sm text-muted-foreground">
          No audit exists for this journey yet. Would you like to start one?
        </p>
        <Button asChild className="bg-brand-600 hover:bg-brand-700">
          <Link to="/journey/new">Start a New Audit</Link>
        </Button>
      </div>
    );
  }

  const { journey, stages } = details;

  const tabs: { id: 'gtm' | 'walkeros' | 'validation'; label: string }[] = [
    { id: 'gtm', label: 'GTM dataLayer' },
    { id: 'walkeros', label: 'WalkerOS flow.json' },
    { id: 'validation', label: 'Validation Spec' },
  ];

  const gtmSpec = specs.gtm as {
    global_setup?: string;
    stages?: Array<{ stage_order: number; stage_label: string; sample_url?: string; code_snippet: string }>;
  } | null | undefined;

  const walkerosSpec = specs.walkeros as {
    readme?: string;
    flow_json?: unknown;
    elb_tags?: Array<{ stage_order: number; stage_label: string; code_snippet: string }>;
  } | null | undefined;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link
              to={`/journey/${id}`}
              className="text-xs text-muted-foreground/60 hover:text-muted-foreground"
            >
              ← Back to journey
            </Link>
          </div>
          <h1 className="text-xl font-bold text-foreground">Implementation Spec</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {stages.length} pages · generated for your developer
          </p>
        </div>
        <Button
          onClick={() => navigate(`/journey/${id}/audit/start`)}
          className="bg-brand-600 hover:bg-brand-700"
        >
          Run Audit →
        </Button>
      </div>

      {/* Funnel breadcrumb */}
      <div className="mb-6 flex flex-wrap items-center gap-1.5">
        {stages.map((s, i) => (
          <span key={s.id} className="flex items-center gap-1.5">
            <span className="rounded-lg bg-muted px-2.5 py-1 text-xs font-medium text-foreground">
              {s.label}
            </span>
            {i < stages.length - 1 && <span className="text-muted-foreground/40 text-xs">→</span>}
          </span>
        ))}
      </div>

      {/* Tabs */}
      <div className="border-b mb-6">
        <div className="flex gap-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'pb-2 text-sm font-medium border-b-2 transition-colors',
                activeTab === tab.id
                  ? 'border-brand-600 text-brand-600'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {tab.label}
              {tab.id === journey.implementation_format && (
                <span className="ml-1.5 rounded bg-brand-50 px-1 py-0.5 text-xs text-brand-600">
                  selected
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* GTM dataLayer tab */}
      {activeTab === 'gtm' && (
        <div className="space-y-4">
          <TabExplainer>
            <strong>What this is:</strong> JavaScript snippets that push structured data into the GTM dataLayer. Your developer adds these to each page of your site. Once deployed, you configure GTM triggers based on the <code className="bg-blue-100 px-1 rounded text-xs">event</code> name to fire your GA4, Google Ads, and Meta tags automatically — no platform SDK on the page required.
            <br /><br />
            <strong>How to use it:</strong> Share this file with your developer. They add each snippet to the corresponding page (not all pages — just the one listed). Replace <code className="bg-blue-100 px-1 rounded text-xs">{'{{PLACEHOLDER}}'}</code> values with your real account IDs before going live.
          </TabExplainer>

          {gtmSpec?.global_setup ? (
            <CodeBlock
              label="Step 1 — GTM Container Snippet (add to every page)"
              filename="gtm-setup.html"
              code={gtmSpec.global_setup}
            />
          ) : (
            <p className="text-xs text-muted-foreground italic">GTM container snippet not generated.</p>
          )}

          {(gtmSpec?.stages ?? []).length > 0 ? (
            <>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Step 2 — Per-page dataLayer events
              </p>
              {(gtmSpec?.stages ?? []).map((stage, i) => (
                <CodeBlock
                  key={i}
                  label={`${stage.stage_label}${stage.sample_url ? ` — ${stage.sample_url}` : ''}`}
                  filename={`stage-${stage.stage_order}-${stage.stage_label.toLowerCase().replace(/\s+/g, '-')}.js`}
                  code={stage.code_snippet}
                />
              ))}
            </>
          ) : (
            <p className="text-xs text-muted-foreground italic">No per-page events generated. Run the spec generator first.</p>
          )}
        </div>
      )}

      {/* WalkerOS tab */}
      {activeTab === 'walkeros' && (
        <div className="space-y-4">
          <TabExplainer>
            <strong>What this is:</strong> A <code className="bg-blue-100 px-1 rounded text-xs">flow.json</code> configuration file for <a href="https://walkeros.com" target="_blank" rel="noopener noreferrer" className="underline">WalkerOS</a> — an open-source, privacy-first data layer alternative. Instead of writing <code className="bg-blue-100 px-1 rounded text-xs">dataLayer.push()</code> manually on every page, you define all tracking behaviour once in this JSON file, and WalkerOS handles firing the right events automatically.
            <br /><br />
            <strong>How to use it:</strong> Pass this file to your developer. They add it to your WalkerOS instance configuration. This replaces the GTM dataLayer snippets — don't use both at the same time.
          </TabExplainer>

          {walkerosSpec?.flow_json ? (
            <CodeBlock
              label="flow.json — WalkerOS Configuration"
              filename="flow.json"
              code={JSON.stringify(walkerosSpec.flow_json, null, 2)}
            />
          ) : (
            <p className="text-xs text-muted-foreground italic">WalkerOS flow.json not generated.</p>
          )}

          {(walkerosSpec?.elb_tags ?? []).length > 0 && (
            <>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-4">
                Per-page elb attribute tags
              </p>
              {(walkerosSpec?.elb_tags ?? []).map((tag, i) => (
                <CodeBlock
                  key={i}
                  label={`${tag.stage_label} — HTML attributes`}
                  filename={`stage-${tag.stage_order}-elb-tags.html`}
                  code={tag.code_snippet}
                />
              ))}
            </>
          )}
        </div>
      )}

      {/* Validation Spec tab */}
      {activeTab === 'validation' && (
        <div className="space-y-4">
          <TabExplainer>
            <strong>What this is:</strong> A machine-readable JSON checklist that describes exactly what Atlas expects to find when it audits your site — which events should fire on each page, which parameters must be present, and which platforms should receive data. This is what Atlas uses internally when it runs a scan.
            <br /><br />
            <strong>How to use it:</strong> Share this with your developer as an acceptance checklist. They can use it to verify their implementation before you run the official Atlas audit. It's also useful as documentation — it captures the full intent of what "correct tracking" looks like for your funnel.
          </TabExplainer>

          {specs.validation ? (
            <CodeBlock
              label="validation-spec.json"
              filename="validation-spec.json"
              code={JSON.stringify(specs.validation, null, 2)}
            />
          ) : (
            <div className="rounded-xl border bg-muted/40 p-6 text-center">
              <p className="text-sm text-muted-foreground">Validation spec not available yet.</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                It will appear here after your first audit run.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
