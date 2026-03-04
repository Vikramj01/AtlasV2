import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { getJourney, getSpec } from '@/lib/api/journeyApi';
import type { JourneyWithDetails } from '@/types/journey';

interface SpecData {
  gtm?: unknown;
  walkeros?: unknown;
}

function CodeBlock({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function download(filename: string) {
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-white">
        <span className="text-xs font-semibold text-gray-600">{label}</span>
        <div className="flex gap-2">
          <button
            onClick={copy}
            className="text-xs text-brand-600 hover:text-brand-700 font-medium"
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
          <button
            onClick={() => download(label.toLowerCase().replace(/\s+/g, '-') + '.txt')}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            Download
          </button>
        </div>
      </div>
      <pre className="p-4 text-xs text-gray-800 overflow-x-auto whitespace-pre-wrap max-h-96">
        {code}
      </pre>
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
    ])
      .then(([journeyDetails, gtmSpec, walkerosSpec]) => {
        setDetails(journeyDetails);
        setSpecs({ gtm: gtmSpec?.spec_data, walkeros: walkerosSpec?.spec_data });
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  function formatGTMSpec(spec: unknown): string {
    if (!spec || typeof spec !== 'object') return '// No GTM spec generated';
    const s = spec as { global_setup?: string; stages?: Array<{ stage_label: string; sample_url?: string; code_snippet: string }> };
    const parts: string[] = [];
    if (s.global_setup) {
      parts.push('// === GTM CONTAINER SETUP ===\n');
      parts.push(s.global_setup);
      parts.push('\n\n');
    }
    for (const stage of s.stages ?? []) {
      parts.push(stage.code_snippet);
      parts.push('\n\n');
    }
    return parts.join('') || '// No stages generated';
  }

  function formatWalkerOSSpec(spec: unknown): string {
    if (!spec || typeof spec !== 'object') return '// No WalkerOS spec generated';
    const s = spec as { flow_json?: unknown; readme?: string };
    const parts: string[] = [];
    if (s.readme) {
      parts.push(s.readme);
      parts.push('\n\n---\n\n');
    }
    if (s.flow_json) {
      parts.push('// flow.json\n');
      parts.push(JSON.stringify(s.flow_json, null, 2));
    }
    return parts.join('') || '// No flow.json generated';
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-gray-500">Loading spec…</p>
      </div>
    );
  }

  if (error || !details) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <p className="text-sm text-red-600">{error ?? 'Journey not found'}</p>
        <Link to="/journey/new" className="mt-4 inline-block text-sm text-brand-600 hover:underline">
          Start a new journey
        </Link>
      </div>
    );
  }

  const { journey, stages } = details;
  const format = journey.implementation_format;
  const hasGTM = format === 'gtm' || format === 'both';
  const hasWalkerOS = format === 'walkeros' || format === 'both';

  const tabs = [
    ...(hasGTM ? [{ id: 'gtm' as const, label: 'GTM dataLayer' }] : []),
    ...(hasWalkerOS ? [{ id: 'walkeros' as const, label: 'WalkerOS flow.json' }] : []),
    { id: 'validation' as const, label: 'Validation Spec (JSON)' },
  ];

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Generated Tracking Spec</h1>
          <p className="mt-1 text-sm text-gray-500">
            {stages.length} stages · {journey.implementation_format.toUpperCase()}
          </p>
        </div>
        <button
          onClick={() => navigate(`/journey/${id}/audit/start`)}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          Run Audit
        </button>
      </div>

      {/* Funnel summary */}
      <div className="mb-6 flex flex-wrap items-center gap-1.5">
        {stages.map((s, i) => (
          <span key={s.id} className="flex items-center gap-1.5">
            <span className="rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
              {s.label}
            </span>
            {i < stages.length - 1 && <span className="text-gray-400 text-xs">→</span>}
          </span>
        ))}
      </div>

      {/* Info banner */}
      <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        Copy this code and add it to your site. Each stage has its own code block — deploy it on the corresponding page.
        Platform IDs shown as <code className="bg-blue-100 px-1 rounded">{'{{PLACEHOLDER}}'}</code> should be replaced with your real values.
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <div className="flex gap-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-brand-600 text-brand-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === 'gtm' && hasGTM && (
        <div className="space-y-4">
          <CodeBlock label="GTM Container Setup" code={(specs.gtm as any)?.global_setup ?? '// GTM snippet not available'} />
          {((specs.gtm as any)?.stages ?? []).map((stage: any, i: number) => (
            <CodeBlock key={i} label={`Stage ${stage.stage_order}: ${stage.stage_label}${stage.sample_url ? ` (${stage.sample_url})` : ''}`} code={stage.code_snippet} />
          ))}
        </div>
      )}

      {activeTab === 'walkeros' && hasWalkerOS && (
        <div className="space-y-4">
          <CodeBlock
            label="flow.json — WalkerOS Configuration"
            code={JSON.stringify((specs.walkeros as any)?.flow_json ?? {}, null, 2)}
          />
          {((specs.walkeros as any)?.elb_tags ?? []).map((tag: any, i: number) => (
            <CodeBlock key={i} label={`Stage ${tag.stage_order}: ${tag.stage_label}`} code={tag.code_snippet} />
          ))}
        </div>
      )}

      {activeTab === 'validation' && (
        <CodeBlock
          label="Validation Spec (for developers)"
          code="// Run GET /api/journeys/:id/specs/validation_spec to download the full spec JSON"
        />
      )}
    </div>
  );
}
