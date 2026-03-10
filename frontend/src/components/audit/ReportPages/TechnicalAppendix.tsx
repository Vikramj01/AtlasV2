import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { SeverityBadge } from '@/components/common/SeverityBadge';
import type { ReportJSON } from '@/types/audit';

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
        <h2 className="text-lg font-semibold">Technical Appendix</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Raw validation data for your developer or GTM implementer.
          Export this as a Developer Technical Report.
        </p>
      </div>

      <Card className="overflow-hidden">
        <button
          onClick={() => setOpen(!open)}
          className="flex w-full items-center justify-between px-5 py-4"
        >
          <span className="text-sm font-semibold">Show Technical Data</span>
          <span className="text-muted-foreground" aria-hidden="true">{open ? '▲ Hide' : '▼ Show'}</span>
        </button>

        {open && (
          <>
            <Separator />
            <CardContent className="p-0 divide-y">
              {/* Validation results */}
              <section className="p-5">
                <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Validation Results ({results.length} rules)
                </h3>
                <div className="space-y-2">
                  {results.map((r) => (
                    <div key={r.rule_id} className="flex flex-wrap items-start gap-3 rounded-lg border p-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-xs font-semibold">{r.rule_id}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground capitalize">{r.validation_layer.replace(/_/g, ' ')}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <SeverityBadge severity={r.severity} size="sm" />
                        <Badge
                          className={cn(
                            r.status === 'pass' ? 'bg-green-100 text-green-700 hover:bg-green-100'
                            : r.status === 'warning' ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-100'
                            : 'bg-red-100 text-red-700 hover:bg-red-100'
                          )}
                        >
                          {r.status}
                        </Badge>
                      </div>
                      {r.technical_details && (
                        <div className="w-full mt-1 rounded bg-muted px-3 py-2 font-mono text-xs space-y-0.5">
                          <p><span className="text-muted-foreground">found:</span> {r.technical_details.found}</p>
                          <p><span className="text-muted-foreground">expected:</span> {r.technical_details.expected}</p>
                          {r.technical_details.evidence.length > 0 && (
                            <ul className="mt-1 pl-3 space-y-0.5 list-disc text-muted-foreground">
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

              {networkRequests.length > 0 && (
                <section className="p-5">
                  <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    Detected Network Calls ({networkRequests.length})
                  </h3>
                  <div className="space-y-2">
                    {networkRequests.map((req, i) => (
                      <div key={i} className="rounded-lg border bg-muted px-3 py-2 font-mono text-xs">
                        <span className="font-semibold">{String(req['method'] ?? 'GET')}</span>{' '}
                        {String(req['url'] ?? '')}
                        {req['step'] && <span className="ml-2 text-muted-foreground">@ {String(req['step'])}</span>}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {dataLayerEvents.length > 0 && (
                <section className="p-5">
                  <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    Data Layer Events ({dataLayerEvents.length})
                  </h3>
                  <div className="space-y-2">
                    {dataLayerEvents.map((ev, i) => (
                      <div key={i} className="rounded-lg border bg-muted px-3 py-2 font-mono text-xs">
                        <span className="font-semibold">{String(ev['event'] ?? 'unknown')}</span>
                        {ev['step'] && <span className="ml-2 text-muted-foreground">@ {String(ev['step'])}</span>}
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}
