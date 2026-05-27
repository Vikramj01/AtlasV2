import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchPublicShare } from '@/lib/api/trackingApi';
import type { PublicShareResult, DataLayerEvent } from '@/types/tracking';

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md bg-gray-900 p-4 text-xs text-green-400 leading-relaxed whitespace-pre-wrap">
      {children}
    </pre>
  );
}

function EventSection({ event }: { event: DataLayerEvent }) {
  const pushCode = JSON.stringify(event.datalayer_push, null, 2);
  const paramEntries = Object.entries(event.parameters);
  const platformEntries = Object.entries(event.platform_mappings);

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="bg-gray-50 px-5 py-3 border-b border-gray-200">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="font-semibold text-gray-900">{event.event_name}</h3>
          <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 border border-blue-200">
            {event.signal_key}
          </span>
        </div>
        <p className="text-xs text-gray-500 mt-1">Trigger: {event.trigger}</p>
      </div>

      <div className="p-5 space-y-5">
        <div>
          <p className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">dataLayer push</p>
          <CodeBlock>{`dataLayer.push(${pushCode});`}</CodeBlock>
        </div>

        {paramEntries.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">Parameters</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left px-3 py-2 border border-gray-200 font-medium text-gray-600">Parameter</th>
                    <th className="text-left px-3 py-2 border border-gray-200 font-medium text-gray-600">Type</th>
                    <th className="text-left px-3 py-2 border border-gray-200 font-medium text-gray-600">Required</th>
                    <th className="text-left px-3 py-2 border border-gray-200 font-medium text-gray-600">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {paramEntries.map(([key, param]) => (
                    <tr key={key} className="even:bg-gray-50">
                      <td className="px-3 py-2 border border-gray-200 font-mono text-gray-800">{key}</td>
                      <td className="px-3 py-2 border border-gray-200 text-gray-600">{param.type}</td>
                      <td className="px-3 py-2 border border-gray-200">
                        {param.required
                          ? <span className="text-red-600 font-medium">Required</span>
                          : <span className="text-gray-400">Optional</span>}
                      </td>
                      <td className="px-3 py-2 border border-gray-200 text-gray-600">{param.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {platformEntries.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">Platform mappings</p>
            <div className="flex flex-wrap gap-2">
              {platformEntries.map(([platform, eventName]) => (
                <div key={platform} className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5">
                  <span className="text-xs font-medium uppercase text-gray-500">{platform}</span>
                  <span className="text-gray-300">→</span>
                  <span className="text-xs font-mono text-gray-700">{eventName}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {event.notes && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-xs text-amber-800">{event.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function PublicDeliverableView() {
  const { token } = useParams<{ token: string }>();
  const [result, setResult] = useState<PublicShareResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setError('Invalid link'); setLoading(false); return; }
    fetchPublicShare(token)
      .then(setResult)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <p className="text-sm text-gray-500">Loading…</p>
      </div>
    );
  }

  if (error || !result) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-4 px-6">
        <div className="text-center max-w-sm">
          <p className="text-xl font-semibold text-gray-900 mb-2">Link expired or invalid</p>
          <p className="text-sm text-gray-500">
            This link has expired or is invalid. Ask your Atlas contact to generate a new one.
          </p>
        </div>
      </div>
    );
  }

  const spec = result.content;
  const events = spec.events ?? [];
  const generatedAt = spec.generated_at ? new Date(spec.generated_at).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  }) : new Date(result.generated_at).toLocaleDateString();

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white sticky top-0 z-10 print:static">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold text-gray-900">Atlas</span>
            <span className="text-gray-300">·</span>
            <span className="text-sm text-gray-600">DataLayer Implementation Spec</span>
          </div>
          <span className="text-xs text-gray-400 print:hidden">
            Expires {new Date(result.expires_at).toLocaleDateString()}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        {/* Title */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{result.client_name}</h1>
          <p className="text-sm text-gray-500 mt-1">
            Generated {generatedAt} · {events.length} event{events.length !== 1 ? 's' : ''}
          </p>
        </div>

        {/* Events */}
        {events.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-gray-500">No events in this spec.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {events.map((event) => (
              <EventSection key={event.signal_key} event={event} />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-gray-100 bg-gray-50 mt-12 py-6 print:mt-4">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <p className="text-xs text-gray-400">Generated by Atlas · atlas.vimi.digital</p>
        </div>
      </div>
    </div>
  );
}
