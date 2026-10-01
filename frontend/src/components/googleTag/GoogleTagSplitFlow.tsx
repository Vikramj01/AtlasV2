// GoogleTagSplitFlow — Google Tag Topology PRD §7/§12. Guidance steps, the
// delta diff, deploy-as-GTM-draft or download, then verify. Atlas never
// publishes: a draft deploy only creates a workspace, and a plan is "verified"
// only after the backend sees a fresh topology observation showing the split.

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { googleTagTopologyApi } from '@/lib/api/googleTagTopologyApi';
import type { GTMContainer } from '@/types/ihc';
import type { SplitDeployResponse, SplitDiff, SplitPlanResponse, SplitVerifyResponse } from '@/types/googleTagTopology';

interface GoogleTagSplitFlowProps {
  clientId: string;
}

function DiffList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-console-fg-muted">{title}</p>
      <ul className="mt-1 list-disc pl-5 text-sm text-console-fg">
        {items.map((i) => <li key={i}>{i}</li>)}
      </ul>
    </div>
  );
}

function hasChanges(d: SplitDiff): boolean {
  return d.tags_added.length + d.variables_added.length + d.triggers_added.length > 0;
}

export function GoogleTagSplitFlow({ clientId }: GoogleTagSplitFlowProps) {
  const [containers, setContainers] = useState<GTMContainer[] | null>(null);
  const [connectionId, setConnectionId] = useState<string>('');
  const [plan, setPlan] = useState<SplitPlanResponse | null>(null);
  const [deployed, setDeployed] = useState<SplitDeployResponse | null>(null);
  const [verify, setVerify] = useState<SplitVerifyResponse | null>(null);
  const [busy, setBusy] = useState<'plan' | 'deploy' | 'download' | 'verify' | null>(null);
  const [confirmDeploy, setConfirmDeploy] = useState(false);
  const [splitDate, setSplitDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    googleTagTopologyApi
      .listContainers()
      .then((all) => {
        if (cancelled) return;
        const mine = all.filter((c) => c.client_id === clientId);
        setContainers(mine);
        if (mine.length > 0) setConnectionId(mine[0].id);
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : 'Failed to load containers'));
    return () => { cancelled = true; };
  }, [clientId]);

  async function run<T>(kind: NonNullable<typeof busy>, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(kind);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  async function buildPlan() {
    setDeployed(null);
    setVerify(null);
    setConfirmDeploy(false);
    const res = await run('plan', () => googleTagTopologyApi.planSplit(connectionId));
    if (res) setPlan(res);
  }

  async function deploy() {
    const res = await run('deploy', () => googleTagTopologyApi.deploySplit(connectionId, plan?.plan_id ?? undefined));
    if (res) {
      setDeployed(res);
      setConfirmDeploy(false);
    }
  }

  async function download() {
    const blob = await run('download', async () => {
      // A download needs a stored plan id, so persist one now if the plan was built without it.
      const planId = plan?.plan_id ?? (await googleTagTopologyApi.planSplit(connectionId, true)).plan_id;
      if (!planId) throw new Error('Nothing to download');
      return googleTagTopologyApi.downloadSplit(planId);
    });
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'atlas-google-tag-split.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function runVerify() {
    if (!deployed) return;
    const res = await run('verify', () => googleTagTopologyApi.verifySplit(deployed.plan_id, splitDate || undefined));
    if (res) setVerify(res);
  }

  if (containers === null && !error) {
    return (
      <div className="flex items-center gap-2 text-sm text-console-fg-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading GTM connections…
      </div>
    );
  }

  if (containers && containers.length === 0) {
    return (
      <p className="text-sm text-console-fg-muted">
        This client has no GTM container connected. Connect one under Implementation Health, then plan the split here.
      </p>
    );
  }

  return (
    <Card className="border-console-border bg-console-surface">
      <CardHeader className="pb-3">
        <CardTitle className="font-heading text-base text-console-fg">Split plan</CardTitle>
        <p className="text-sm text-console-fg-muted">
          Atlas builds only what is missing — a Google tag per destination — and never edits or deletes an existing tag.
          Nothing is published; you review and publish in GTM.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {containers && containers.length > 1 && (
          <label className="block text-sm text-console-fg">
            Container
            <select
              className="mt-1 block w-full rounded border border-console-border bg-console-bg px-2 py-1 text-sm"
              value={connectionId}
              onChange={(e) => { setConnectionId(e.target.value); setPlan(null); }}
            >
              {containers.map((c) => <option key={c.id} value={c.id}>{c.container_id} ({c.auth_method})</option>)}
            </select>
          </label>
        )}

        <Button size="sm" onClick={buildPlan} disabled={!connectionId || busy !== null}>
          {busy === 'plan' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
          {plan ? 'Rebuild plan' : 'Build split plan'}
        </Button>

        {error && <p className="text-sm text-severity-critical">{error}</p>}

        {plan && (
          <div className="space-y-4">
            {plan.conflicts.length > 0 && (
              <div className="rounded border border-severity-critical/40 bg-severity-critical-bg p-3">
                <p className="flex items-center gap-1.5 text-sm font-medium text-severity-critical">
                  <AlertTriangle className="h-4 w-4" /> Atlas can&apos;t plan this automatically
                </p>
                <ul className="mt-1 list-disc pl-5 text-sm text-console-fg">
                  {plan.conflicts.map((c) => <li key={c.message}>{c.message}</li>)}
                </ul>
              </div>
            )}

            {plan.conflicts.length === 0 && !hasChanges(plan.diff) && (
              <p className="text-sm text-console-fg-muted">
                No Google tag changes are needed: every destination Atlas can see already has its own sitewide Google tag.
              </p>
            )}

            {hasChanges(plan.diff) && (
              <div className="space-y-3 rounded border border-console-border p-3">
                <p className="text-sm font-medium text-console-fg">What Atlas will add</p>
                <DiffList title="Tags" items={plan.diff.tags_added} />
                <DiffList title="Variables" items={plan.diff.variables_added} />
                <DiffList title="Triggers" items={plan.diff.triggers_added} />
                <DiffList title="Already in place" items={plan.diff.already_covered} />
              </div>
            )}

            <ol className="space-y-2">
              {plan.guidance.map((g) => (
                <li key={g.step} className="rounded border border-console-border p-3">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-console-fg">
                    {g.step}. {g.title}
                    {g.evidence === 'unverified' && (
                      <span className="rounded-full bg-severity-warning-bg px-2 py-0.5 text-[10px] font-medium text-severity-warning">
                        Needs confirmation
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-sm text-console-fg-muted">{g.body}</p>
                </li>
              ))}
            </ol>

            {hasChanges(plan.diff) && plan.conflicts.length === 0 && !deployed && (
              <div className="flex flex-wrap items-center gap-2">
                {plan.can_deploy_draft && !confirmDeploy && (
                  <Button size="sm" onClick={() => setConfirmDeploy(true)} disabled={busy !== null}>
                    Deploy as GTM draft
                  </Button>
                )}
                {plan.can_deploy_draft && confirmDeploy && (
                  <>
                    <span className="text-sm text-console-fg">Create a new draft workspace in this container? Nothing is published.</span>
                    <Button size="sm" onClick={deploy} disabled={busy !== null}>
                      {busy === 'deploy' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                      Create draft
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setConfirmDeploy(false)} disabled={busy !== null}>Cancel</Button>
                  </>
                )}
                {!plan.can_deploy_draft && (
                  <span className="text-sm text-console-fg-muted">
                    This container was connected by manual upload, so Atlas can&apos;t write to it. Download the file and import it in GTM.
                  </span>
                )}
                <Button size="sm" variant="outline" onClick={download} disabled={busy !== null}>
                  {busy === 'download' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}
                  Download import file
                </Button>
              </div>
            )}

            {deployed && (
              <div className="space-y-3 rounded border border-console-border p-3">
                <p className="flex items-center gap-1.5 text-sm font-medium text-console-fg">
                  <CheckCircle2 className="h-4 w-4 text-severity-success" /> Draft created ({deployed.tags_created} tags). Not published.
                </p>
                <a
                  className="inline-flex items-center gap-1 text-sm text-console-primary underline"
                  href={deployed.workspace_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open the draft in GTM <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <label className="block text-sm text-console-fg">
                  Date you split the tags in Google (optional — defaults to today)
                  <input
                    type="date"
                    className="mt-1 block rounded border border-console-border bg-console-bg px-2 py-1 text-sm"
                    value={splitDate}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setSplitDate(e.target.value)}
                  />
                </label>
                <div>
                  <Button size="sm" variant="outline" onClick={runVerify} disabled={busy !== null}>
                    {busy === 'verify' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                    Verify the split
                  </Button>
                </div>
                {verify && (
                  verify.verified ? (
                    <p className="flex items-center gap-1.5 text-sm text-severity-success">
                      <CheckCircle2 className="h-4 w-4" /> Verified: the Google tags are split and the Ads Google tag is present. Atlas has recorded this date so reports and insights can explain the change in how data is collected.
                    </p>
                  ) : (
                    <div>
                      <p className="text-sm font-medium text-console-fg">Not verified yet</p>
                      <ul className="mt-1 list-disc pl-5 text-sm text-console-fg-muted">
                        {verify.reasons.map((r) => <li key={r}>{r}</li>)}
                      </ul>
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
