/**
 * CrmOutcomesTab — CRM Outcome Integration Sprint 8 (docs/prd/crm-outcome-integration.md §10).
 *
 * Rendered inside CAPIMonitoringDashboard for every provider (unlike
 * Audience/Refunds, which are Google-only) since a CRM sync config is
 * per-client, not per-CAPI-provider — there's no single provider this tab
 * belongs under. Self-contained: fetches the org's own CRM sync configs via
 * crmApi.listConfigs() rather than receiving a client_id/config_id prop
 * from the parent, and lets the user pick a config when more than one
 * exists.
 *
 * The day-grouped chart is backed by a real GET /configs/:id/outcomes/daily
 * query (Implementation Rule 12 — no fabricated series); the table never
 * renders raw PII, only crm_record_id/stage/value/identity METHOD (not the
 * identifier itself)/delivery status, mirroring crm_outcome_events' own
 * no-raw-PII-at-rest guarantee (§5.4).
 */

import { useEffect, useState, useCallback } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { crmApi } from '@/lib/api/crmApi';
import type { CrmSyncConfig, CrmOutcomeEvent, CrmDailyOutcomeCount, CrmDeliveryStatus, CrmIdentityMethod } from '@/types/crm';

const PAGE_SIZE = 25;

const DELIVERY_STATUS_BADGE: Record<CrmDeliveryStatus, string> = {
  delivered: 'bg-severity-success-bg text-severity-success',
  partial: 'bg-severity-warning-bg text-severity-warning',
  pending: 'bg-console-chip text-console-fg-muted',
  failed: 'bg-severity-critical-bg text-severity-critical',
  skipped_unresolved: 'bg-console-chip text-console-fg-muted',
  skipped_window: 'bg-console-chip text-console-fg-muted',
  dedup_skipped: 'bg-console-chip text-console-fg-muted',
};

const DELIVERY_STATUS_LABEL: Record<CrmDeliveryStatus, string> = {
  delivered: 'Delivered',
  partial: 'Partial',
  pending: 'Pending',
  failed: 'Failed',
  skipped_unresolved: 'Skipped (unresolved identity)',
  skipped_window: 'Skipped (ingest window)',
  dedup_skipped: 'Skipped (duplicate)',
};

const IDENTITY_METHOD_LABEL: Record<CrmIdentityMethod, string> = {
  click_id: 'Click ID',
  hashed_email: 'Hashed email',
  hashed_phone: 'Hashed phone',
  unresolved: 'Unresolved',
};

function DeliveryStatusBadge({ status }: { status: CrmDeliveryStatus }) {
  return (
    <span className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${DELIVERY_STATUS_BADGE[status]}`}>
      {DELIVERY_STATUS_LABEL[status]}
    </span>
  );
}

function DailyOutcomesChart({ counts }: { counts: CrmDailyOutcomeCount[] }) {
  if (counts.length === 0) {
    return <p className="text-sm text-console-fg-muted">No outcomes recorded in this window yet.</p>;
  }

  const max = Math.max(...counts.map((c) => c.total), 1);

  return (
    <div className="flex h-32 items-end gap-0.5">
      {counts.map((c) => (
        <div key={c.date} className="group relative flex-1" title={`${c.date}: ${c.delivered}/${c.total} delivered`}>
          <div className="flex h-32 flex-col justify-end gap-px">
            <div
              className="w-full rounded-sm bg-console-primary/30"
              style={{ height: `${Math.max((c.total / max) * 100, 2)}%` }}
            />
          </div>
          <div
            className="absolute bottom-0 w-full rounded-sm bg-console-primary"
            style={{ height: `${Math.max((c.delivered / max) * 100, c.delivered > 0 ? 2 : 0)}%` }}
          />
        </div>
      ))}
    </div>
  );
}

export function CrmOutcomesTab() {
  const [configs, setConfigs] = useState<CrmSyncConfig[]>([]);
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  const [loadingConfigs, setLoadingConfigs] = useState(true);
  const [configsError, setConfigsError] = useState<string | null>(null);

  const [dailyCounts, setDailyCounts] = useState<CrmDailyOutcomeCount[]>([]);
  const [loadingDaily, setLoadingDaily] = useState(false);

  const [rows, setRows] = useState<CrmOutcomeEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loadingRows, setLoadingRows] = useState(false);
  const [rowsError, setRowsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingConfigs(true);
    crmApi
      .listConfigs()
      .then((data) => {
        if (cancelled) return;
        setConfigs(data);
        setSelectedConfigId((prev) => prev ?? data[0]?.id ?? null);
      })
      .catch((err) => !cancelled && setConfigsError(err instanceof Error ? err.message : 'Failed to load CRM configs'))
      .finally(() => !cancelled && setLoadingConfigs(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const loadRows = useCallback((configId: string, at: number) => {
    setLoadingRows(true);
    setRowsError(null);
    crmApi
      .getOutcomes(configId, { limit: PAGE_SIZE, offset: at })
      .then((res) => {
        setRows(res.rows);
        setTotal(res.total);
      })
      .catch((err) => setRowsError(err instanceof Error ? err.message : 'Failed to load outcomes'))
      .finally(() => setLoadingRows(false));
  }, []);

  useEffect(() => {
    if (!selectedConfigId) return;
    setOffset(0);
    loadRows(selectedConfigId, 0);

    setLoadingDaily(true);
    crmApi
      .getDailyOutcomeCounts(selectedConfigId, 30)
      .then(setDailyCounts)
      .catch(() => setDailyCounts([]))
      .finally(() => setLoadingDaily(false));
  }, [selectedConfigId, loadRows]);

  const goToPage = (nextOffset: number) => {
    if (!selectedConfigId) return;
    setOffset(nextOffset);
    loadRows(selectedConfigId, nextOffset);
  };

  if (loadingConfigs) {
    return (
      <div className="flex items-center gap-2 text-sm text-console-fg-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading CRM sync configs…
      </div>
    );
  }

  if (configsError) {
    return <p className="text-sm text-severity-critical">{configsError}</p>;
  }

  if (configs.length === 0) {
    return (
      <p className="text-sm text-console-fg-muted">
        No CRM sync config for this org yet — connect HubSpot or Salesforce and set up a stage ladder
        on the CRM Integration page to see outcome delivery here.
      </p>
    );
  }

  const selectedConfig = configs.find((c) => c.id === selectedConfigId) ?? null;

  return (
    <div className="space-y-4">
      {configs.length > 1 && (
        <Select value={selectedConfigId ?? undefined} onValueChange={setSelectedConfigId}>
          <SelectTrigger className="w-full max-w-xs border-console-border bg-console-chip text-console-fg">
            <SelectValue placeholder="Select a CRM sync config" />
          </SelectTrigger>
          <SelectContent>
            {configs.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.provider} — {c.client_id}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Card className="border-console-border bg-console-surface">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-console-fg">Outcomes, last 30 days</CardTitle>
          <p className="text-sm text-console-fg-muted">
            Total CRM outcome events synced per day (light bar) vs. delivered to at least one
            destination (dark bar).
          </p>
        </CardHeader>
        <CardContent>
          {loadingDaily ? (
            <div className="flex items-center gap-2 text-sm text-console-fg-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <DailyOutcomesChart counts={dailyCounts} />
          )}
        </CardContent>
      </Card>

      <Card className="border-console-border bg-console-surface">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base text-console-fg">Outcome events</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => selectedConfigId && loadRows(selectedConfigId, offset)}
            disabled={loadingRows || !selectedConfigId}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingRows ? 'animate-spin' : ''}`} />
          </Button>
        </CardHeader>
        <CardContent>
          {rowsError ? (
            <p className="text-sm text-severity-critical">{rowsError}</p>
          ) : loadingRows ? (
            <div className="flex items-center gap-2 text-sm text-console-fg-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading outcomes…
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-console-fg-muted">
              No outcome events yet for {selectedConfig?.provider ?? 'this config'} — the ladder hasn't
              synced any stage changes, or nothing has been mapped/enabled.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>CRM record</TableHead>
                      <TableHead>Atlas event</TableHead>
                      <TableHead>Value</TableHead>
                      <TableHead>Identity</TableHead>
                      <TableHead>Delivery</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-xs text-console-fg-muted whitespace-nowrap">
                          {new Date(r.created_at).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-sm text-console-fg whitespace-nowrap">{r.crm_record_id}</TableCell>
                        <TableCell className="text-sm text-console-fg-muted">{r.atlas_event_name}</TableCell>
                        <TableCell className="text-sm text-console-fg-muted whitespace-nowrap">
                          {r.conversion_value != null ? `${r.conversion_value} ${r.currency ?? ''}` : '—'}
                        </TableCell>
                        <TableCell className="text-sm text-console-fg-muted">{IDENTITY_METHOD_LABEL[r.identity_method]}</TableCell>
                        <TableCell><DeliveryStatusBadge status={r.delivery_status} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-console-fg-muted">
                <span>
                  Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => goToPage(Math.max(offset - PAGE_SIZE, 0))}>
                    Previous
                  </Button>
                  <Button variant="outline" size="sm" disabled={offset + PAGE_SIZE >= total} onClick={() => goToPage(offset + PAGE_SIZE)}>
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
