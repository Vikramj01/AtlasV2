// DerivedValuePanel — surfaces the latest crm_derived_value_snapshots per
// stage (PRD §7.3, Sprint 7). Only meaningful in DERIVED mode: in DECLARED
// mode the calculator never writes snapshots for this config, so the panel
// renders a short explanatory note instead of an empty table.

import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { useOutcomesStore } from '@/store/outcomesStore';
import type { OutcomeSourceConfig, OutcomeDerivedValueSnapshot, DerivedConfidence } from '@/types/outcomes';

interface DerivedValuePanelProps {
  config: OutcomeSourceConfig;
}

const CONFIDENCE_BADGE: Record<DerivedConfidence, string> = {
  high: 'bg-severity-success-bg text-severity-success',
  low: 'bg-severity-warning-bg text-severity-warning',
  withheld: 'bg-console-chip text-console-fg-muted',
};

function ConfidenceBadge({ confidence }: { confidence: DerivedConfidence }) {
  return (
    <span className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${CONFIDENCE_BADGE[confidence]}`}>
      {confidence}
    </span>
  );
}

function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

export function DerivedValuePanel({ config }: DerivedValuePanelProps) {
  const { derivedValues, loading, errors, loadDerivedValues } = useOutcomesStore();

  const loadKey = `derived-values-${config.id}`;
  const loadingValues = loading[loadKey] ?? false;
  const loadError = errors[loadKey];
  const snapshots: OutcomeDerivedValueSnapshot[] = derivedValues[config.id] ?? [];

  useEffect(() => {
    if (config.value_mode === 'DERIVED') loadDerivedValues(config.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.id, config.value_mode]);

  if (config.value_mode !== 'DERIVED') {
    return null;
  }

  return (
    <Card className="border-console-border bg-console-surface">
      <CardHeader className="pb-3">
        <CardTitle className="text-base text-console-fg">Derived Values</CardTitle>
        <p className="text-sm text-console-fg-muted">
          stage_to_won_rate × avg_won_amount over a trailing window, recomputed weekly.
          A stage below the sample-size floor shows <span className="font-medium">withheld</span> and
          falls back to its declared value — never a value computed from a handful of deals.
        </p>
      </CardHeader>
      <CardContent>
        {loadingValues ? (
          <div className="flex items-center gap-2 text-sm text-console-fg-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading derived values…
          </div>
        ) : loadError ? (
          <p className="text-sm text-severity-critical">{loadError}</p>
        ) : snapshots.length === 0 ? (
          <p className="text-sm text-console-fg-muted">
            No snapshot yet — the weekly calculation hasn't run for this config, or there isn't
            enough closed-won history to compute one. Stages will resolve to their declared value
            until then.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>CRM stage</TableHead>
                  <TableHead>Sample size</TableHead>
                  <TableHead>Reached won</TableHead>
                  <TableHead>Stage → won rate</TableHead>
                  <TableHead>Avg won amount</TableHead>
                  <TableHead>Derived value</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Window</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshots.map((s) => (
                  <TableRow key={s.crm_stage_id}>
                    <TableCell className="text-sm text-console-fg whitespace-nowrap">{s.crm_stage_id}</TableCell>
                    <TableCell className="text-sm text-console-fg-muted">{s.sample_size}</TableCell>
                    <TableCell className="text-sm text-console-fg-muted">{s.reached_won_count}</TableCell>
                    <TableCell className="text-sm text-console-fg-muted">{formatRate(s.stage_to_won_rate)}</TableCell>
                    <TableCell className="text-sm text-console-fg-muted">{s.avg_won_amount} {s.currency}</TableCell>
                    <TableCell className="text-sm text-console-fg">{s.derived_value} {s.currency}</TableCell>
                    <TableCell><ConfidenceBadge confidence={s.confidence} /></TableCell>
                    <TableCell className="text-xs text-console-fg-muted whitespace-nowrap">{s.window_start} → {s.window_end}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
