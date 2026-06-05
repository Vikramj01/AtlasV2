import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  ShieldCheck,
  ShieldAlert,
  Upload,
  Trash2,
  RefreshCw,
  CheckCircle2,
  ChevronRight,
  Loader2,
  AlertTriangle,
  Square,
  CheckSquare,
  EyeOff,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { PlanGate } from '@/components/common/PlanGate';
import { SectionErrorBoundary } from '@/components/common/ErrorBoundary';
import { ihcApi } from '@/lib/api/ihcApi';
import { slackApi } from '@/lib/api/slackApi';
import { ShareToSlackButton } from '@/components/common/ShareToSlackButton';
import type { AuditFinding, GTMContainer, BaselineInfo, FindingsSummary, FindingSeverity } from '@/types/ihc';

const SEVERITY_COLORS: Record<FindingSeverity, string> = {
  critical: 'text-red-600 bg-red-50 border-red-200',
  high:     'text-orange-600 bg-orange-50 border-orange-200',
  medium:   'text-yellow-700 bg-yellow-50 border-yellow-200',
  low:      'text-gray-600 bg-gray-50 border-gray-200',
};

const SEVERITY_DOT: Record<FindingSeverity, string> = {
  critical: 'bg-red-500',
  high:     'bg-orange-400',
  medium:   'bg-yellow-400',
  low:      'bg-gray-300',
};

const STATUS_BADGE: Record<string, string> = {
  open:         'bg-red-100 text-red-700',
  acknowledged: 'bg-yellow-100 text-yellow-700',
  resolved:     'bg-green-100 text-green-700',
  suppressed:   'bg-gray-100 text-gray-500',
};

const LAYER_LABELS: Record<string, string> = {
  signal_initiation:      'Signal Initiation',
  parameter_completeness: 'Parameter Completeness',
  persistence:            'Persistence',
  tag_configuration:      'GTM Configuration',
  implementation_drift:   'Drift Detection',
};

// ── Section: GTM Containers ───────────────────────────────────────────────────

function GTMContainersSection() {
  const [containers, setContainers] = useState<GTMContainer[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ihcApi
      .getContainers()
      .then(setContainers)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleFileUpload(file: File) {
    setUploading(true);
    setUploadError(null);
    setUploadSuccess(false);
    try {
      const text = await file.text();
      const json = JSON.parse(text) as Record<string, unknown>;
      await ihcApi.uploadContainerJSON('default', json);
      setUploadSuccess(true);
      const updated = await ihcApi.getContainers();
      setContainers(updated);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed. Check the JSON format.');
    } finally {
      setUploading(false);
    }
  }

  async function handleDisconnect(id: string) {
    if (!window.confirm('Disconnect this GTM container? Configuration data will be removed.')) return;
    setDisconnecting(id);
    try {
      await ihcApi.disconnectContainer(id);
      setContainers((prev) => prev.filter((c) => c.id !== id));
    } catch {
      alert('Failed to disconnect container. Please try again.');
    } finally {
      setDisconnecting(null);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">GTM Container</CardTitle>
        <p className="text-sm text-muted-foreground">
          Connect your GTM container so Atlas can inspect tag configuration for issues.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading containers…
          </div>
        ) : containers.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <p className="text-sm text-muted-foreground">No GTM container connected yet.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Upload your GTM container export to enable tag configuration checks.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {containers.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
                <div>
                  <p className="text-sm font-medium font-mono">{c.container_id}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.auth_method === 'oauth' ? 'OAuth' : 'Manual upload'}
                    {c.last_synced_at && (
                      <> · Last synced {new Date(c.last_synced_at).toLocaleDateString()}</>
                    )}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => handleDisconnect(c.id)}
                  disabled={disconnecting === c.id}
                >
                  {disconnecting === c.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}

        <Separator />

        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Upload Container JSON</p>
          <p className="text-xs text-muted-foreground">
            Export your container from GTM (Admin → Export Container) and upload the JSON file here.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileUpload(file);
              e.target.value = '';
            }}
          />
          {uploadError && (
            <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 p-3 text-xs text-red-700">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              {uploadError}
            </div>
          )}
          {uploadSuccess && (
            <div className="flex items-center gap-2 rounded-md bg-green-50 border border-green-200 p-3 text-xs text-green-700">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              Container uploaded. IHC rules are running — check back in a minute.
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="gap-2"
          >
            {uploading ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Uploading…</>
            ) : (
              <><Upload className="h-4 w-4" /> Upload Container JSON</>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Section: Baseline ─────────────────────────────────────────────────────────

function BaselineSection() {
  const [baseline, setBaseline] = useState<BaselineInfo | null | undefined>(undefined);
  const [promoting, setPromoting] = useState(false);
  const [crawlRunId, setCrawlRunId] = useState('');

  useEffect(() => {
    ihcApi
      .getBaseline()
      .then(setBaseline)
      .catch(() => setBaseline(null));
  }, []);

  async function handlePromote() {
    if (!crawlRunId.trim()) return;
    setPromoting(true);
    try {
      await ihcApi.promoteBaseline(crawlRunId.trim());
      const updated = await ihcApi.getBaseline();
      setBaseline(updated);
      setCrawlRunId('');
    } catch {
      alert('Failed to promote baseline. Ensure the crawl run ID is correct.');
    } finally {
      setPromoting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Drift Detection Baseline</CardTitle>
        <p className="text-sm text-muted-foreground">
          A baseline is a known-good crawl snapshot. Drift detection compares your current site against it to flag regressions.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {baseline === undefined ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : baseline === null ? (
          <div className="rounded-lg border border-dashed border-border p-5 text-center">
            <p className="text-sm text-muted-foreground">No baseline set.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              The first successful crawl is auto-promoted. You can also set one manually below.
            </p>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
            <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
            <div>
              <p className="text-sm font-medium text-green-800">Baseline active</p>
              <p className="text-xs text-green-700">
                Promoted {new Date(baseline.promoted_at).toLocaleDateString()} · Run ID:{' '}
                <span className="font-mono">{baseline.crawl_run_id.slice(0, 8)}…</span>
              </p>
            </div>
          </div>
        )}

        <Separator />

        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Set new baseline</p>
          <p className="text-xs text-muted-foreground">
            Enter a crawl run ID from the{' '}
            <Link to="/health" className="text-[#1B2A4A] underline-offset-2 hover:underline">
              Signal Scan
            </Link>{' '}
            page to promote it as the new baseline.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={crawlRunId}
              onChange={(e) => setCrawlRunId(e.target.value)}
              placeholder="Crawl run UUID"
              className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={handlePromote}
              disabled={!crawlRunId.trim() || promoting}
              className="gap-2 shrink-0"
            >
              {promoting ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Promoting…</>
              ) : (
                <><RefreshCw className="h-4 w-4" /> Set baseline</>
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Section: Findings ─────────────────────────────────────────────────────────

function FindingsBadge({ count, severity }: { count: number; severity: FindingSeverity }) {
  if (count === 0) return null;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${SEVERITY_COLORS[severity]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${SEVERITY_DOT[severity]}`} />
      {count} {severity}
    </span>
  );
}

function FindingsSection() {
  const [findings, setFindings] = useState<AuditFinding[]>([]);
  const [summary, setSummary] = useState<FindingsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeLayer, setActiveLayer] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkActing, setBulkActing] = useState(false);

  useEffect(() => {
    Promise.all([ihcApi.getFindings(), ihcApi.getFindingsSummary()])
      .then(([f, s]) => {
        setFindings(f);
        setSummary(s);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const layers = ['all', ...Array.from(new Set(findings.map((f) => f.validation_layer)))];

  const visible = activeLayer === 'all'
    ? findings
    : findings.filter((f) => f.validation_layer === activeLayer);

  const open = visible.filter((f) => f.status === 'open');
  const resolved = visible.filter((f) => f.status !== 'open');

  const openIds = open.map((f) => f.id);
  const allSelected = openIds.length > 0 && openIds.every((id) => selectedIds.has(id));
  const someSelected = openIds.some((id) => selectedIds.has(id));

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(openIds));
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function applyLocalStatus(ids: string[], status: AuditFinding['status']) {
    setFindings((prev) =>
      prev.map((f) => (ids.includes(f.id) ? { ...f, status } : f)),
    );
    setSelectedIds(new Set());
  }

  async function handleSingleAction(
    id: string,
    action: 'acknowledge' | 'resolve' | 'suppress',
  ) {
    const statusMap = { acknowledge: 'acknowledged', resolve: 'resolved', suppress: 'suppressed' } as const;
    try {
      await ihcApi.updateFinding(id, statusMap[action]);
      applyLocalStatus([id], statusMap[action]);
    } catch {
      alert('Failed to update finding. Please try again.');
    }
  }

  async function handleBulkAction(action: 'acknowledge' | 'resolve' | 'suppress') {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkActing(true);
    try {
      await ihcApi.bulkUpdateFindings(ids, action);
      const statusMap = { acknowledge: 'acknowledged', resolve: 'resolved', suppress: 'suppressed' } as const;
      applyLocalStatus(ids, statusMap[action]);
    } catch {
      alert('Bulk action failed. Please try again.');
    } finally {
      setBulkActing(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-base">Open Findings</CardTitle>
            <p className="text-sm text-muted-foreground">
              Issues detected by the tag configuration and drift detection rules.
            </p>
          </div>
          {summary && (
            <div className="flex flex-wrap gap-1.5">
              <FindingsBadge count={summary.critical} severity="critical" />
              <FindingsBadge count={summary.high} severity="high" />
              <FindingsBadge count={summary.medium} severity="medium" />
              <FindingsBadge count={summary.low} severity="low" />
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading findings…
          </div>
        ) : findings.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-green-200 bg-green-50 py-10 text-center">
            <ShieldCheck className="h-8 w-8 text-green-500" />
            <p className="font-semibold text-green-800">No findings detected.</p>
            <p className="text-sm text-green-700">
              Connect a GTM container or run a site crawl to start detection.
            </p>
          </div>
        ) : (
          <>
            {/* Layer filter tabs */}
            {layers.length > 2 && (
              <div className="flex flex-wrap gap-1.5">
                {layers.map((layer) => (
                  <button
                    key={layer}
                    type="button"
                    onClick={() => setActiveLayer(layer)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      activeLayer === layer
                        ? 'border-[#1B2A4A] bg-[#1B2A4A] text-white'
                        : 'border-border bg-background text-muted-foreground hover:border-[#1B2A4A]/40'
                    }`}
                  >
                    {layer === 'all' ? 'All layers' : (LAYER_LABELS[layer as keyof typeof LAYER_LABELS] ?? layer)}
                  </button>
                ))}
              </div>
            )}

            {/* Bulk action bar */}
            {someSelected && (
              <div className="flex items-center gap-2 rounded-lg border border-[#1B2A4A]/20 bg-[#1B2A4A]/5 px-4 py-2">
                <span className="text-xs font-medium text-[#1B2A4A] mr-2">
                  {selectedIds.size} selected
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5"
                  disabled={bulkActing}
                  onClick={() => handleBulkAction('acknowledge')}
                >
                  {bulkActing ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                  Acknowledge
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5"
                  disabled={bulkActing}
                  onClick={() => handleBulkAction('resolve')}
                >
                  {bulkActing ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3 text-green-600" />}
                  Resolve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5 text-muted-foreground"
                  disabled={bulkActing}
                  onClick={() => handleBulkAction('suppress')}
                >
                  {bulkActing ? <Loader2 className="h-3 w-3 animate-spin" /> : <EyeOff className="h-3 w-3" />}
                  Suppress
                </Button>
                <button
                  type="button"
                  className="ml-auto text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setSelectedIds(new Set())}
                >
                  Clear
                </button>
              </div>
            )}

            {/* Open findings */}
            {open.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleSelectAll}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    title={allSelected ? 'Deselect all' : 'Select all open'}
                  >
                    {allSelected ? (
                      <CheckSquare className="h-4 w-4 text-[#1B2A4A]" />
                    ) : (
                      <Square className="h-4 w-4" />
                    )}
                  </button>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Open ({open.length})
                  </p>
                </div>
                <div className="rounded-lg border border-border overflow-hidden divide-y divide-border">
                  {open.map((f) => (
                    <FindingCard
                      key={f.id}
                      finding={f}
                      expanded={expandedId === f.id}
                      selected={selectedIds.has(f.id)}
                      onToggle={() => setExpandedId((prev) => (prev === f.id ? null : f.id))}
                      onSelect={() => toggleSelect(f.id)}
                      onAcknowledge={() => handleSingleAction(f.id, 'acknowledge')}
                      onResolve={() => handleSingleAction(f.id, 'resolve')}
                      onSuppress={() => handleSingleAction(f.id, 'suppress')}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Resolved findings */}
            {resolved.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Resolved / Suppressed ({resolved.length})
                </p>
                <div className="rounded-lg border border-border overflow-hidden divide-y divide-border opacity-60">
                  {resolved.map((f) => (
                    <FindingCard
                      key={f.id}
                      finding={f}
                      expanded={expandedId === f.id}
                      onToggle={() => setExpandedId((prev) => (prev === f.id ? null : f.id))}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function FindingCard({
  finding,
  expanded,
  selected,
  onToggle,
  onSelect,
  onAcknowledge,
  onResolve,
  onSuppress,
}: {
  finding: AuditFinding;
  expanded: boolean;
  selected?: boolean;
  onToggle: () => void;
  onSelect?: () => void;
  onAcknowledge?: () => void;
  onResolve?: () => void;
  onSuppress?: () => void;
}) {
  const evidenceEntries = Object.entries(finding.evidence ?? {}).slice(0, 6);
  const isOpen = finding.status === 'open';

  return (
    <div>
      <div className="flex items-start gap-2 px-4 py-3 hover:bg-muted/40 transition-colors">
        {/* Checkbox (open findings only) */}
        {isOpen && onSelect ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onSelect(); }}
            className="mt-1 shrink-0 text-muted-foreground hover:text-[#1B2A4A] transition-colors"
          >
            {selected ? (
              <CheckSquare className="h-4 w-4 text-[#1B2A4A]" />
            ) : (
              <Square className="h-4 w-4" />
            )}
          </button>
        ) : (
          <span className="mt-2 h-2 w-2 shrink-0 rounded-full" />
        )}

        {/* Main row — click to expand */}
        <button
          type="button"
          onClick={onToggle}
          className="flex flex-1 items-start gap-2 text-left min-w-0"
        >
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[finding.severity]}`} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold font-mono truncate">{finding.rule_id}</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_BADGE[finding.status] ?? 'bg-gray-100 text-gray-600'}`}>
                {finding.status}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {LAYER_LABELS[finding.validation_layer as keyof typeof LAYER_LABELS] ?? finding.validation_layer}
              </span>
              <span className="text-[10px] text-muted-foreground">
                Detected {new Date(finding.first_detected_at).toLocaleDateString()}
              </span>
            </div>
          </div>
          <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </button>
      </div>

      {expanded && (
        <div className="px-4 pb-4 ml-10">
          {evidenceEntries.length > 0 && (
            <div className="rounded-md bg-muted p-3 space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Evidence</p>
              {evidenceEntries.map(([k, v]) => (
                <div key={k} className="flex gap-3 text-xs">
                  <span className="font-semibold text-muted-foreground min-w-[120px] shrink-0">{k}</span>
                  <span className="font-mono text-foreground break-all">{String(v)}</span>
                </div>
              ))}
            </div>
          )}
          <p className="mt-2 text-[10px] text-muted-foreground">
            Last seen: {new Date(finding.last_seen_at).toLocaleString()}
          </p>

          {/* Per-finding action buttons (open only) */}
          {isOpen && (onAcknowledge || onResolve || onSuppress) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {onAcknowledge && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5"
                  onClick={onAcknowledge}
                >
                  <CheckCircle2 className="h-3 w-3" /> Acknowledge
                </Button>
              )}
              {onResolve && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5 text-green-700 border-green-200 hover:bg-green-50"
                  onClick={onResolve}
                >
                  <CheckCircle2 className="h-3 w-3" /> Resolve
                </Button>
              )}
              {onSuppress && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs gap-1.5 text-muted-foreground"
                  onClick={onSuppress}
                >
                  <EyeOff className="h-3 w-3" /> Suppress
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Section: Notification preferences ────────────────────────────────────────

function PreferencesSection() {
  const [prefs, setPrefs] = useState({
    email_critical_enabled: true,
    email_high_digest_enabled: true,
    email_medium_digest_enabled: true,
    email_low_enabled: false,
    daily_digest_hour: 9,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    ihcApi.getPreferences().then((p) => {
      if (p) setPrefs((prev) => ({ ...prev, ...p }));
    }).catch(() => {});
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await ihcApi.savePreferences(prefs);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      alert('Failed to save preferences.');
    } finally {
      setSaving(false);
    }
  }

  function toggle(key: keyof typeof prefs) {
    setPrefs((p) => ({ ...p, [key]: !p[key] }));
  }

  const rows: { key: keyof typeof prefs; label: string; description: string }[] = [
    { key: 'email_critical_enabled',       label: 'Critical alerts',  description: 'Immediate email when a critical finding is detected (batched 15 min)' },
    { key: 'email_high_digest_enabled',    label: 'High — daily digest', description: 'Daily email listing high-severity findings' },
    { key: 'email_medium_digest_enabled',  label: 'Medium — weekly digest', description: 'Weekly summary of medium-severity findings' },
    { key: 'email_low_enabled',            label: 'Low — in-app only', description: 'Low-severity findings appear in-app only by default' },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Notification Preferences</CardTitle>
        <p className="text-sm text-muted-foreground">
          Control how and when you receive alerts about implementation health issues.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          {rows.map(({ key, label, description }) => (
            <div key={key} className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs text-muted-foreground">{description}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={Boolean(prefs[key])}
                onClick={() => toggle(key)}
                className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 ${
                  prefs[key] ? 'bg-[#1B2A4A]' : 'bg-gray-200'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                    prefs[key] ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          ))}
        </div>

        <Separator />

        <div className="flex items-center gap-3">
          <div className="flex-1">
            <p className="text-sm font-medium">Daily digest hour (UTC)</p>
            <p className="text-xs text-muted-foreground">Hour of day for daily / weekly digest delivery</p>
          </div>
          <select
            value={prefs.daily_digest_hour}
            onChange={(e) => setPrefs((p) => ({ ...p, daily_digest_hour: Number(e.target.value) }))}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20"
          >
            {Array.from({ length: 24 }, (_, i) => (
              <option key={i} value={i}>{String(i).padStart(2, '0')}:00 UTC</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleSave} disabled={saving} className="bg-[#1B2A4A] text-white hover:bg-[#1B2A4A]/90">
            {saving ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" /> Saving…</> : 'Save preferences'}
          </Button>
          {saved && (
            <span className="flex items-center gap-1 text-xs text-green-600">
              <CheckCircle2 className="h-3.5 w-3.5" /> Saved
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function ImplementationHealthPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <Link to="/settings" className="hover:text-[#1B2A4A]">← Settings</Link>
          </div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <ShieldAlert className="h-6 w-6 text-[#1B2A4A]" />
            Implementation Health
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            GTM configuration checks, drift detection, and alert preferences.
          </p>
        </div>
        <ShareToSlackButton
          onShare={(destinationId) => slackApi.shareIHC(destinationId).then(() => undefined)}
        />
      </div>

      <PlanGate minPlan="pro" featureName="Implementation Health Checks">
        <div className="space-y-6">
          <SectionErrorBoundary label="GTM containers">
            <GTMContainersSection />
          </SectionErrorBoundary>

          <SectionErrorBoundary label="Baseline">
            <BaselineSection />
          </SectionErrorBoundary>

          <SectionErrorBoundary label="Findings">
            <FindingsSection />
          </SectionErrorBoundary>

          <SectionErrorBoundary label="Preferences">
            <PreferencesSection />
          </SectionErrorBoundary>
        </div>
      </PlanGate>
    </div>
  );
}
