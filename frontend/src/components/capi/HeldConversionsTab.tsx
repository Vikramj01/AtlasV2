/**
 * HeldConversionsTab — junk conversion gate review surface (GA4 Admin / L11 / Junk Gate PRD §C.9, C2).
 *
 * Per client: the gate's config (observe is the default and never holds anything), the queue of
 * held conversions with single/bulk release and reject, and — in observe mode — the same rows as a
 * read-only "would have held" log. Every figure here comes from /api/junk-gate; there is no chart
 * because no time-series endpoint backs one (Implementation Rule 12).
 *
 * `hybrid` rows carry the §C.3 explanation: holding withholds only the copy Atlas sends, so a
 * browser pixel firing the same conversion still reaches the platform.
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { junkGateApi } from '@/lib/api/junkGateApi';
import { clientApi } from '@/lib/api/organisationApi';
import { useOrganisationStore } from '@/store/organisationStore';
import type { Client } from '@/types/organisation';
import type { HeldConversion, HoldStatus, JunkAction, JunkGateConfig, JunkGateConfigView, JunkGateMetrics, JunkGateMode, JunkTimeoutAction } from '@/types/junkGate';

type View = 'held' | 'decided' | 'observed';

const VIEW_STATUSES: Record<View, HoldStatus[]> = {
  held: ['held'],
  decided: ['released', 'rejected', 'auto_released', 'auto_dropped'],
  observed: ['observed'],
};
const VIEW_LABEL: Record<View, string> = { held: 'Held', decided: 'Decided', observed: 'Would have held' };

const STATUS_LABEL: Record<HoldStatus, string> = {
  observed: 'Observed', held: 'Held', released: 'Released', rejected: 'Rejected',
  auto_released: 'Auto-released', auto_dropped: 'Auto-dropped',
};

const PAGE_SIZE = 25;

const HYBRID_NOTE =
  'Hybrid: a browser pixel or Google tag may fire this same conversion client-side. Holding it here withholds only the copy Atlas sends — the platform can still receive the browser event.';
const SERVER_ONLY_NOTE = 'Server-only: Atlas is the only sender for this destination, so holding it fully withholds the conversion.';

function formatRemaining(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds <= 0) return 'Due';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function DeliveryClassBadge({ value }: { value: HeldConversion['delivery_class'] }) {
  if (!value) return <span className="text-console-fg-muted">—</span>;
  const hybrid = value === 'hybrid';
  return (
    <span
      title={hybrid ? HYBRID_NOTE : SERVER_ONLY_NOTE}
      className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${hybrid ? 'bg-severity-warning-bg text-severity-warning' : 'bg-severity-success-bg text-severity-success'}`}
    >
      {hybrid ? 'Hybrid' : 'Server-only'}
    </span>
  );
}

function ConfigPanel({ clientId }: { clientId: string }) {
  const [view, setView] = useState<JunkGateConfigView | null>(null);
  const [draft, setDraft] = useState<JunkGateConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    junkGateApi.getConfig(clientId)
      .then((v) => { if (!cancelled) { setView(v); setDraft(v.config); } })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Failed to load gate config'))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [clientId]);

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const v = await junkGateApi.saveConfig(clientId, {
        mode: draft.mode, action_junk: draft.action_junk, action_suspect: draft.action_suspect,
        hold_timeout_hours: draft.hold_timeout_hours, timeout_action: draft.timeout_action,
        hold_rate_alert_pct: draft.hold_rate_alert_pct,
        // The server replaces the whole thresholds object, so send the full set back with the one edit.
        thresholds: draft.thresholds,
      });
      setView(v);
      setDraft(v.config);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="flex items-center gap-2 text-sm text-console-fg-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading gate config…</div>;
  if (!draft || !view) return error ? <p className="text-sm text-severity-critical">{error}</p> : null;

  const dirty = JSON.stringify(draft) !== JSON.stringify(view.config);
  const actionSelect = (value: JunkAction, onChange: (a: JunkAction) => void) => (
    <Select value={value} onValueChange={(v) => onChange(v as JunkAction)} disabled={draft.mode !== 'enforce'}>
      <SelectTrigger className="w-32 border-console-border bg-console-chip text-console-fg"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="hold">Hold</SelectItem>
        <SelectItem value="drop">Drop</SelectItem>
        <SelectItem value="send">Send anyway</SelectItem>
      </SelectContent>
    </Select>
  );

  return (
    <Card className="border-console-border bg-console-surface">
      <CardHeader className="pb-3">
        <CardTitle className="font-heading text-base text-console-fg">Gate settings</CardTitle>
        <p className="text-sm text-console-fg-muted">
          Observe (the default) records what the gate would have done and never delays or blocks a conversion.
          Enforce holds or drops junk and suspect conversions before they reach your ad platforms.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1 text-xs text-console-fg-muted">Mode
            <Select value={draft.mode} onValueChange={(v) => setDraft({ ...draft, mode: v as JunkGateMode })}>
              <SelectTrigger className="border-console-border bg-console-chip text-console-fg"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Off</SelectItem>
                <SelectItem value="observe">Observe</SelectItem>
                <SelectItem value="enforce">Enforce</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="space-y-1 text-xs text-console-fg-muted">Junk verdict
            {actionSelect(draft.action_junk, (a) => setDraft({ ...draft, action_junk: a }))}
          </label>
          <label className="space-y-1 text-xs text-console-fg-muted">Suspect verdict
            {actionSelect(draft.action_suspect, (a) => setDraft({ ...draft, action_suspect: a }))}
          </label>
          <label className="space-y-1 text-xs text-console-fg-muted">Unreviewed after
            <div className="flex items-center gap-2">
              <input
                type="number" min={1} max={72} value={draft.hold_timeout_hours}
                onChange={(e) => setDraft({ ...draft, hold_timeout_hours: Math.min(72, Math.max(1, Number(e.target.value) || 1)) })}
                disabled={draft.mode !== 'enforce'}
                className="w-20 rounded-md border border-console-border bg-console-chip px-2 py-1.5 font-mono text-sm text-console-fg disabled:opacity-50"
              />
              <span className="text-console-fg-muted">hours</span>
            </div>
          </label>
        </div>

        <label className="flex max-w-sm flex-col gap-1 text-xs text-console-fg-muted">When the time is up
          <Select value={draft.timeout_action} onValueChange={(v) => setDraft({ ...draft, timeout_action: v as JunkTimeoutAction })} disabled={draft.mode !== 'enforce'}>
            <SelectTrigger className="border-console-border bg-console-chip text-console-fg"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="release">Release it (recommended — a real lead is never lost)</SelectItem>
              <SelectItem value="drop">Drop it</SelectItem>
            </SelectContent>
          </Select>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1 text-xs text-console-fg-muted">Flag a submit faster than
            <div className="flex items-center gap-2">
              <input
                type="number" min={0.1} max={60} step={0.1} value={draft.thresholds.min_submit_ms / 1000}
                onChange={(e) => setDraft({ ...draft, thresholds: { ...draft.thresholds, min_submit_ms: Math.min(60_000, Math.max(100, Math.round((Number(e.target.value) || 2) * 1000))) } })}
                className="w-20 rounded-md border border-console-border bg-console-chip px-2 py-1.5 font-mono text-sm text-console-fg"
              />
              <span className="text-console-fg-muted">seconds after first form interaction</span>
            </div>
          </label>
          <label className="space-y-1 text-xs text-console-fg-muted">Alert me when more than
            <div className="flex items-center gap-2">
              <input
                type="number" min={1} max={100} value={draft.hold_rate_alert_pct}
                onChange={(e) => setDraft({ ...draft, hold_rate_alert_pct: Math.min(100, Math.max(1, Math.round(Number(e.target.value) || 30))) })}
                className="w-20 rounded-md border border-console-border bg-console-chip px-2 py-1.5 font-mono text-sm text-console-fg"
              />
              <span className="text-console-fg-muted">% of the last 24h is flagged</span>
            </div>
          </label>
        </div>
        <p className="text-xs text-console-fg-muted">
          The submit-timing and honeypot checks only see conversions whose page runs the Atlas Signal Tag (generated for Meta
          containers); a fast autofill-and-submit can look like a bot, so check the overturn figures below before enforcing.
        </p>

        {view.hold_ceiling_hours !== null && (
          <p className="text-xs text-console-fg-muted">
            Holds are capped at {view.hold_ceiling_hours} hours for this client: the shortest ad-platform ingest window among its
            connected destinations, minus a 12-hour safety margin.
            {view.timeout_will_clamp && <span className="text-severity-warning"> Your saved timeout is longer, so it is shortened to this cap.</span>}
          </p>
        )}

        {error && <p className="text-sm text-severity-critical">{error}</p>}
        <Button size="sm" onClick={save} disabled={!dirty || saving}>
          {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}Save settings
        </Button>
      </CardContent>
    </Card>
  );
}

const pct = (v: number | null): string => (v === null ? '—' : `${Math.round(v * 1000) / 10}%`);

function MetricsPanel({ metrics, loading }: { metrics: JunkGateMetrics | null; loading: boolean }) {
  if (loading && !metrics) return <div className="flex items-center gap-2 text-sm text-console-fg-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading metrics…</div>;
  if (!metrics) return null;
  const stat = (label: string, value: string) => (
    <div className="rounded-md border border-console-border bg-console-chip px-3 py-2">
      <div className="font-mono text-lg text-console-fg">{value}</div>
      <div className="text-[11px] text-console-fg-muted">{label}</div>
    </div>
  );
  return (
    <Card className="border-console-border bg-console-surface">
      <CardHeader className="pb-3">
        <CardTitle className="font-heading text-base text-console-fg">Last {metrics.window_days} days</CardTitle>
        <p className="text-sm text-console-fg-muted">
          {metrics.evaluated.toLocaleString()} conversions evaluated.
          {metrics.truncated && ' Showing the newest 20,000 only.'}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {stat('Flagged', pct(metrics.flagged_rate))}
          {stat('Held', pct(metrics.hold_rate))}
          {stat('Auto-released', String(metrics.auto_released))}
          {stat('Auto-dropped', String(metrics.auto_dropped))}
          {stat('Released by review', String(metrics.reviewed_released))}
          {stat('Overturned', pct(metrics.overturn_rate))}
        </div>
        {metrics.rules.length === 0 ? (
          <p className="text-sm text-console-fg-muted">No rule has fired in this window.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rule</TableHead>
                <TableHead className="text-right">Hits</TableHead>
                <TableHead className="text-right">Hit rate</TableHead>
                <TableHead className="text-right">Reviewed</TableHead>
                <TableHead className="text-right">Released on review</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {metrics.rules.map((r) => (
                <TableRow key={r.rule_id}>
                  <TableCell className="font-mono text-xs text-console-fg">
                    {r.rule_id}
                    {r.likely_holding_good_leads && (
                      <span
                        title="Reviewers released at least half of the conversions this rule held. It may be flagging good leads."
                        className="ml-2 inline-flex rounded-full bg-severity-warning-bg px-2 py-0.5 font-sans text-[10px] font-medium text-severity-warning"
                      >Often released — may hold good leads</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">{r.hits}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{pct(r.hit_rate)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{r.reviewed}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{r.reviewed > 0 ? pct(r.overturn_rate) : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export function HeldConversionsTab() {
  const { currentOrg } = useOrganisationStore();
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState<string | null>(null);
  const [loadingClients, setLoadingClients] = useState(true);

  const [view, setView] = useState<View>('held');
  const [rows, setRows] = useState<HeldConversion[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [acting, setActing] = useState(false);
  const [metrics, setMetrics] = useState<JunkGateMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);

  useEffect(() => {
    if (!currentOrg) { setLoadingClients(false); return; }
    let cancelled = false;
    clientApi.list(currentOrg.id)
      .then((c) => { if (!cancelled) { setClients(c); setClientId((p) => p ?? c[0]?.id ?? null); } })
      .catch(() => !cancelled && setClients([]))
      .finally(() => !cancelled && setLoadingClients(false));
    return () => { cancelled = true; };
  }, [currentOrg]);

  const load = useCallback((cid: string, v: View, at: number) => {
    setLoading(true);
    setError(null);
    junkGateApi.listHolds({ client_id: cid, status: VIEW_STATUSES[v], limit: PAGE_SIZE, offset: at })
      .then((r) => { setRows(r.holds); setTotal(r.total); setSelected(new Set()); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load conversions'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    setMetricsLoading(true);
    junkGateApi.getMetrics(clientId, 30)
      .then((m) => { if (!cancelled) setMetrics(m); })
      .catch(() => { if (!cancelled) setMetrics(null); })
      .finally(() => { if (!cancelled) setMetricsLoading(false); });
    return () => { cancelled = true; };
  }, [clientId]);

  useEffect(() => {
    if (!clientId) return;
    setOffset(0);
    load(clientId, view, 0);
  }, [clientId, view, load]);

  async function act(ids: string[], action: 'release' | 'reject') {
    if (!clientId || ids.length === 0) return;
    setActing(true);
    setError(null);
    try {
      await junkGateApi.bulk(ids, action);
      load(clientId, view, offset);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setActing(false);
    }
  }

  if (loadingClients) return <div className="flex items-center gap-2 text-sm text-console-fg-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading clients…</div>;
  if (clients.length === 0 || !clientId) {
    return <p className="text-sm text-console-fg-muted">Add a client to configure the junk conversion gate for it.</p>;
  }

  const actionable = view === 'held';
  const flaggedRules = new Set((metrics?.rules ?? []).filter((r) => r.likely_holding_good_leads).map((r) => r.rule_id));
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id: string) => setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <ShieldAlert className="h-4 w-4 text-console-fg-muted" strokeWidth={1.5} />
        {clients.length > 1 ? (
          <Select value={clientId} onValueChange={setClientId}>
            <SelectTrigger className="w-full max-w-xs border-console-border bg-console-chip text-console-fg"><SelectValue /></SelectTrigger>
            <SelectContent>{clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        ) : (
          <span className="font-heading text-sm text-console-fg">{clients[0].name}</span>
        )}
      </div>

      <ConfigPanel clientId={clientId} />

      <MetricsPanel metrics={metrics} loading={metricsLoading} />

      <Card className="border-console-border bg-console-surface">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="font-heading text-base text-console-fg">Conversions flagged by the gate</CardTitle>
            <div className="flex items-center gap-2">
              <div className="flex items-center rounded-lg border border-console-border p-0.5">
                {(Object.keys(VIEW_LABEL) as View[]).map((v) => (
                  <button
                    key={v} type="button" onClick={() => setView(v)}
                    className={`rounded px-3 py-1 text-xs font-medium transition-colors ${view === v ? 'bg-console-primary text-white' : 'text-console-fg-muted hover:text-console-fg'}`}
                  >{VIEW_LABEL[v]}</button>
                ))}
              </div>
              <Button variant="ghost" size="sm" onClick={() => load(clientId, view, offset)} disabled={loading} aria-label="Refresh">
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>
          {view === 'observed' && (
            <p className="text-sm text-console-fg-muted">
              Read-only log of conversions the gate flagged while in observe mode. Nothing was held — each was sent as normal.
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {error && <p className="text-sm text-severity-critical">{error}</p>}

          {actionable && rows.length > 0 && (
            <div className="flex items-center gap-2">
              <Button size="sm" disabled={selected.size === 0 || acting} onClick={() => act([...selected], 'release')}>Release selected ({selected.size})</Button>
              <Button size="sm" variant="outline" disabled={selected.size === 0 || acting} onClick={() => act([...selected], 'reject')}>Reject selected</Button>
            </div>
          )}

          {loading && rows.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-console-fg-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-console-fg-muted">
              {view === 'held' ? 'Nothing is being held for review.' : view === 'decided' ? 'No held conversions have been decided yet.' : 'The gate has not flagged any conversions in observe mode yet.'}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {actionable && <TableHead className="w-8"><Checkbox checked={allSelected} onCheckedChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))} aria-label="Select all" /></TableHead>}
                  <TableHead>Event</TableHead>
                  <TableHead>Verdict</TableHead>
                  <TableHead>Why it was flagged</TableHead>
                  <TableHead>Delivery</TableHead>
                  <TableHead>{actionable ? 'Time left' : 'Status'}</TableHead>
                  {actionable && <TableHead className="text-right">Action</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    {actionable && <TableCell><Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} aria-label="Select conversion" /></TableCell>}
                    <TableCell>
                      <div className="font-mono text-xs text-console-fg">{r.event_name}</div>
                      <div className="text-[11px] text-console-fg-muted">{new Date(r.event_time).toLocaleString()}</div>
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${r.verdict === 'junk' ? 'bg-severity-critical-bg text-severity-critical' : 'bg-severity-warning-bg text-severity-warning'}`}>
                        {r.verdict === 'junk' ? 'Junk' : 'Suspect'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <ul className="space-y-0.5 text-xs text-console-fg-muted">
                        {r.rule_hits.map((h) => (
                          <li key={h.rule_id}>
                            <span className="font-mono text-console-fg">{h.rule_id}</span> — {h.evidence}
                            {flaggedRules.has(h.rule_id) && <span className="ml-1 text-[10px] text-severity-warning">(often released on review)</span>}
                          </li>
                        ))}
                      </ul>
                    </TableCell>
                    <TableCell>
                      <DeliveryClassBadge value={r.delivery_class} />
                      {r.delivery_class === 'hybrid' && r.status === 'held' && (
                        <p className="mt-1 max-w-[16rem] text-[11px] text-console-fg-muted">{HYBRID_NOTE}</p>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-console-fg-muted">
                      {actionable ? (
                        <>
                          <span className="font-mono text-console-fg">{formatRemaining(r.seconds_remaining)}</span>
                          {r.timeout_clamped && <div className="text-[11px] text-severity-warning">Shortened to fit the platform window</div>}
                        </>
                      ) : STATUS_LABEL[r.status]}
                    </TableCell>
                    {actionable && (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="outline" disabled={acting} onClick={() => act([r.id], 'release')}>Release</Button>
                          <Button size="sm" variant="ghost" disabled={acting} onClick={() => act([r.id], 'reject')}>Reject</Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between pt-1 text-xs text-console-fg-muted">
              <span>{offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={offset === 0 || loading} onClick={() => { const n = Math.max(0, offset - PAGE_SIZE); setOffset(n); load(clientId, view, n); }}>Previous</Button>
                <Button size="sm" variant="outline" disabled={offset + PAGE_SIZE >= total || loading} onClick={() => { const n = offset + PAGE_SIZE; setOffset(n); load(clientId, view, n); }}>Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
