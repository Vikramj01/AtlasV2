// GoogleTagTopologyCard — Google Tag Topology PRD §12. Verdict badge, the
// destinations on each Google tag (primary marked), an evidence chip, "Needs
// confirmation" when the verdict isn't established, and a declaration form.
// Combination lives in Google's tag admin, not the container, so Atlas can only
// show what it observed or was told — the chips say which.

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { googleTagTopologyApi } from '@/lib/api/googleTagTopologyApi';
import { GoogleTagSplitFlow } from './GoogleTagSplitFlow';
import type {
  DeclarationSource,
  GoogleTagTopology,
  TopologyRecord,
  TopologySource,
  TopologyStrength,
  TopologyVerdict,
} from '@/types/googleTagTopology';

interface GoogleTagTopologyCardProps {
  orgId: string;
  clientId: string;
}

const VERDICT_LABEL: Record<TopologyVerdict, string> = {
  SPLIT: 'One Google tag per destination',
  COMBINED: 'Destinations combined on one Google tag',
  COMBINED_ADS_PRIMARY: 'Combined, Google Ads is the primary ID',
  UNKNOWN: 'Not known yet',
};

const VERDICT_STYLE: Record<TopologyVerdict, string> = {
  SPLIT: 'bg-severity-success-bg text-severity-success',
  COMBINED: 'bg-severity-warning-bg text-severity-warning',
  COMBINED_ADS_PRIMARY: 'bg-severity-critical-bg text-severity-critical',
  UNKNOWN: 'bg-console-chip text-console-fg-muted',
};

const SOURCE_LABEL: Record<TopologySource, string> = {
  gtm_api: 'GTM API',
  runtime_observed: 'Observed on the site',
  operator_declared: 'Declared',
};

const STRENGTH_LABEL: Record<TopologyStrength, string> = {
  declared: 'Client confirmed',
  observed: 'Observed',
  assumed: 'Assumed',
  none: 'No evidence yet',
};

function needsConfirmation(strength: TopologyStrength): boolean {
  return strength === 'assumed' || strength === 'none';
}

function Chip({ children, className }: { children: React.ReactNode; className: string }) {
  return <span className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${className}`}>{children}</span>;
}

function TagRow({ row }: { row: TopologyRecord }) {
  return (
    <li className="rounded border border-console-border p-3">
      <p className="font-mono text-sm text-console-fg">{row.google_tag_id}</p>
      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-console-fg-muted">
        {row.destination_ids.map((d) => (
          <span key={d} className="rounded bg-console-chip px-1.5 py-0.5 font-mono text-xs text-console-fg">
            {d}{d === row.primary_destination_id && row.destination_ids.length > 1 ? ' · primary' : ''}
          </span>
        ))}
      </p>
      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-console-fg-subtle">
        {SOURCE_LABEL[row.source]}
        <Chip className="bg-console-chip text-console-fg-muted">{row.evidence_class === 'DIRECT' ? 'Direct evidence' : 'Inferred'}</Chip>
        {row.inferred && <Chip className="bg-severity-warning-bg text-severity-warning">From co-occurrence only</Chip>}
      </p>
    </li>
  );
}

export function GoogleTagTopologyCard({ orgId, clientId }: GoogleTagTopologyCardProps) {
  const [topology, setTopology] = useState<GoogleTagTopology | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSplit, setShowSplit] = useState(false);

  // Declaration form
  const [tagId, setTagId] = useState('');
  const [destinations, setDestinations] = useState('');
  const [primary, setPrimary] = useState('');
  const [declSource, setDeclSource] = useState<DeclarationSource>('OPERATOR_ASSUMED');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTopology(await googleTagTopologyApi.getTopology(orgId, clientId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load topology');
    } finally {
      setLoading(false);
    }
  }, [orgId, clientId]);

  useEffect(() => { load(); }, [load]);

  async function submitDeclaration(e: React.FormEvent) {
    e.preventDefault();
    const ids = destinations.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    setSaving(true);
    setError(null);
    try {
      await googleTagTopologyApi.declare(orgId, clientId, {
        google_tag_id: tagId.trim(),
        destination_ids: ids,
        ...(primary.trim() ? { primary_destination_id: primary.trim() } : {}),
        declaration_source: declSource,
      });
      setTagId(''); setDestinations(''); setPrimary('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save declaration');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="border-console-border bg-console-surface">
        <CardHeader className="pb-3">
          <CardTitle className="font-heading text-base text-console-fg">Google tag topology</CardTitle>
          <p className="text-sm text-console-fg-muted">
            Whether this client&apos;s Google destinations (GA4, Google Ads) share one Google tag. That lives in Google&apos;s tag
            settings, not in the GTM container, so Atlas shows what it observed on the site or was told.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-console-fg-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading topology…
            </div>
          ) : topology ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Chip className={`${VERDICT_STYLE[topology.verdict]} !text-xs`}>{VERDICT_LABEL[topology.verdict]}</Chip>
                <Chip className="bg-console-chip text-console-fg-muted">{STRENGTH_LABEL[topology.strength]}</Chip>
                {needsConfirmation(topology.strength) && (
                  <Chip className="bg-severity-warning-bg text-severity-warning">Needs confirmation</Chip>
                )}
              </div>

              {topology.current.length === 0 ? (
                <p className="text-sm text-console-fg-muted">
                  Nothing observed yet. Run a scan for this client, or record what you know below.
                </p>
              ) : (
                <ul className="space-y-2">{topology.current.map((r) => <TagRow key={r.id} row={r} />)}</ul>
              )}

              {topology.verdict !== 'SPLIT' && (
                <Button size="sm" variant="outline" onClick={() => setShowSplit((v) => !v)}>
                  {showSplit ? 'Hide split plan' : 'Plan a split'}
                </Button>
              )}
            </>
          ) : null}

          {error && <p className="text-sm text-severity-critical">{error}</p>}
        </CardContent>
      </Card>

      {showSplit && <GoogleTagSplitFlow clientId={clientId} />}

      <Card className="border-console-border bg-console-surface">
        <CardHeader className="pb-3">
          <CardTitle className="font-heading text-sm text-console-fg">Record what you know</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submitDeclaration} className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-console-fg">
              Google tag ID
              <input className="mt-1 block w-full rounded border border-console-border bg-console-bg px-2 py-1 font-mono text-sm" value={tagId} onChange={(e) => setTagId(e.target.value)} placeholder="G-XXXXXXX or AW-123456789" required />
            </label>
            <label className="text-sm text-console-fg">
              Destination IDs on that tag
              <input className="mt-1 block w-full rounded border border-console-border bg-console-bg px-2 py-1 font-mono text-sm" value={destinations} onChange={(e) => setDestinations(e.target.value)} placeholder="G-XXXXXXX, AW-123456789" required />
            </label>
            <label className="text-sm text-console-fg">
              Primary ID (optional)
              <input className="mt-1 block w-full rounded border border-console-border bg-console-bg px-2 py-1 font-mono text-sm" value={primary} onChange={(e) => setPrimary(e.target.value)} />
            </label>
            <label className="text-sm text-console-fg">
              How sure are you?
              <select className="mt-1 block w-full rounded border border-console-border bg-console-bg px-2 py-1 text-sm" value={declSource} onChange={(e) => setDeclSource(e.target.value as DeclarationSource)}>
                <option value="OPERATOR_ASSUMED">Assumed</option>
                <option value="CLIENT_CONFIRMED">Confirmed by the client</option>
              </select>
            </label>
            <div className="sm:col-span-2">
              <Button type="submit" size="sm" disabled={saving}>
                {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                Save
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
