import { useState } from 'react';
import type { ReportJSON } from '@/types/audit';
import { SeverityBadge } from '@/components/common/SeverityBadge';

interface Props {
  report: ReportJSON;
}

export function TechnicalAppendix({ report }: Props) {
  const [open, setOpen] = useState(false);
  const { technical_appendix } = report;
  const results = technical_appendix.validation_results;
  const networkRequests = technical_appendix.raw_network_requests as Array<Record<string, unknown>>;
  const dataLayerEvents = technical_appendix.raw_datalayer_events as Array<Record<string, unknown>>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Technical Appendix</h2>
        <p className="mt-1 text-sm text-gray-500">
          Raw validation data for your developer or GTM implementer.
          Export this as a Developer Technical Report.
        </p>
      </div>

      {/* Toggle */}
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <button
          onClick={() => setOpen(!open)}
          className="flex w-full items-center justify-between px-5 py-4"
        >
          <span className="text-sm font-semibold text-gray-700">Show Technical Data</span>
          <span className="text-gray-400" aria-hidden="true">{open ? '▲ Hide' : '▼ Show'}</span>
        </button>

        {open && (
          <div className="border-t border-gray-100 divide-y divide-gray-100">
            {/* Validation results */}
            <section className="p-5">
              <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-gray-500">
                Validation Results ({results.length} rules)
              </h3>
              <div className="space-y-2">
                {results.map((r) => (
                  <div key={r.rule_id} className="flex flex-wrap items-start gap-3 rounded-lg border border-gray-100 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-xs font-semibold text-gray-800">{r.rule_id}</p>
                      <p className="mt-0.5 text-xs text-gray-500 capitalize">{r.validation_layer.replace(/_/g, ' ')}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <SeverityBadge severity={r.severity} size="sm" />
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          r.status === 'pass' ? 'bg-green-100 text-green-700'
                          : r.status === 'warning' ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {r.status}
                      </span>
                    </div>
                    {r.technical_details && (
                      <div className="w-full mt-1 rounded bg-gray-50 px-3 py-2 font-mono text-xs text-gray-600 space-y-0.5">
                        <p><span className="text-gray-400">found:</span> {r.technical_details.found}</p>
                        <p><span className="text-gray-400">expected:</span> {r.technical_details.expected}</p>
                        {r.technical_details.evidence.length > 0 && (
                          <ul className="mt-1 pl-3 space-y-0.5 list-disc text-gray-500">
                            {r.technical_details.evidence.map((e, i) => (
                              <li key={i}>{e}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* Network requests */}
            {networkRequests.length > 0 && (
              <section className="p-5">
                <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-gray-500">
                  Detected Network Calls ({networkRequests.length})
                </h3>
                <div className="space-y-2">
                  {networkRequests.map((req, i) => (
                    <div key={i} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 font-mono text-xs text-gray-600">
                      <span className="font-semibold text-gray-800">{String(req['method'] ?? 'GET')}</span>{' '}
                      {String(req['url'] ?? '')}
                      {req['step'] && <span className="ml-2 text-gray-400">@ {String(req['step'])}</span>}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* DataLayer events */}
            {dataLayerEvents.length > 0 && (
              <section className="p-5">
                <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-gray-500">
                  Data Layer Events ({dataLayerEvents.length})
                </h3>
                <div className="space-y-2">
                  {dataLayerEvents.map((ev, i) => (
                    <div key={i} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 font-mono text-xs text-gray-600">
                      <span className="font-semibold text-gray-800">{String(ev['event'] ?? 'unknown')}</span>
                      {ev['step'] && <span className="ml-2 text-gray-400">@ {String(ev['step'])}</span>}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
