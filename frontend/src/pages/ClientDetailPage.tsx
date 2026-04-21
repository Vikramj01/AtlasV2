import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ExternalLink, Package, Download, Plus, Trash2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { clientApi } from '@/lib/api/organisationApi';
import { DeploymentWizard } from '@/components/signals/DeploymentWizard';
import { SkeletonCard } from '@/components/common/SkeletonCard';
import type { ClientWithDetails, ClientDeployment, ClientOutput } from '@/types/organisation';

const OUTPUT_LABELS: Record<string, string> = {
  gtm_container: 'GTM Container JSON',
  datalayer_spec: 'dataLayer Spec',
  implementation_guide: 'Implementation Guide',
};

const OUTPUT_ICONS: Record<string, string> = {
  gtm_container: '📦',
  datalayer_spec: '💻',
  implementation_guide: '📄',
};

const HEALTH_COLOR = (score: number | null | undefined) => {
  if (score === null || score === undefined) return 'text-muted-foreground';
  if (score >= 80) return 'text-green-700';
  if (score >= 60) return 'text-yellow-700';
  return 'text-red-700';
};

export function ClientDetailPage() {
  const { orgId, clientId } = useParams<{ orgId: string; clientId: string }>();
  const [client, setClient] = useState<ClientWithDetails | null>(null);
  const [deployments, setDeployments] = useState<ClientDeployment[]>([]);
  const [outputs, setOutputs] = useState<ClientOutput[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRunningAudit, setIsRunningAudit] = useState(false);
  const [showDeployWizard, setShowDeployWizard] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!orgId || !clientId) return;
    const data = await clientApi.get(orgId, clientId);
    setClient(data);
    setDeployments(data.deployments ?? []);
    setOutputs(data.outputs ?? []);
  }

  useEffect(() => {
    setIsLoading(true);
    load().catch((err) => setError(err.message)).finally(() => setIsLoading(false));
  }, [orgId, clientId]);

  async function handleGenerate() {
    if (!orgId || !clientId) return;
    setIsGenerating(true);
    setError(null);
    try {
      const { outputs: newOutputs } = await clientApi.generateOutputs(orgId, clientId);
      setOutputs(newOutputs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleRunAudit() {
    if (!orgId || !clientId) return;
    setIsRunningAudit(true);
    try {
      const { audit_id } = await clientApi.runAudit(orgId, clientId);
      window.location.href = `/audit/${audit_id}/progress`;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Audit failed to start');
      setIsRunningAudit(false);
    }
  }

  async function handleRemoveDeployment(deploymentId: string) {
    if (!orgId || !clientId) return;
    await clientApi.removeDeployment(orgId, clientId, deploymentId);
    setDeployments((d) => d.filter((dep) => dep.id !== deploymentId));
  }

  if (isLoading) {
    return <SkeletonCard variant="page" />;
  }
  if (!client) return <div className="p-6 text-sm text-red-600">Client not found.</div>;

  const latestOutputsByType = outputs.reduce<Record<string, ClientOutput>>((acc, o) => {
    if (!acc[o.output_type] || o.version > acc[o.output_type].version) {
      acc[o.output_type] = o;
    }
    return acc;
  }, {});

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold">{client.name}</h1>
            <Badge variant="outline" className="text-xs">{client.business_type}</Badge>
          </div>
          <a
            href={client.website_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-0.5"
          >
            {client.website_url}
            <ExternalLink className="h-3 w-3" />
          </a>
          {client.signal_health !== null && client.signal_health !== undefined && (
            <p className={`text-xs font-medium mt-1 ${HEALTH_COLOR(client.signal_health)}`}>
              Signal Health: {client.signal_health}/100
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleRunAudit}
            disabled={isRunningAudit || deployments.length === 0}
          >
            {isRunningAudit ? 'Starting…' : 'Run Audit'}
          </Button>
          <Button size="sm" onClick={handleGenerate} disabled={isGenerating || deployments.length === 0}>
            {isGenerating ? 'Generating…' : 'Generate Outputs'}
          </Button>
        </div>
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>}

      {/* Ungenerated-outputs nudge */}
      {deployments.length > 0 && deployments.some((d) => !d.last_generated_at) && !isGenerating && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-800">
              {deployments.filter((d) => !d.last_generated_at).length} pack
              {deployments.filter((d) => !d.last_generated_at).length !== 1 ? 's' : ''} deployed — outputs not yet generated
            </p>
            <p className="mt-0.5 text-xs text-amber-700">
              Generate outputs to get the GTM container JSON, dataLayer spec, and implementation guide for this client.
            </p>
          </div>
          <Button size="sm" variant="outline" className="shrink-0 border-amber-300 text-amber-800 hover:bg-amber-100" onClick={handleGenerate}>
            Generate now
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Deployed Tracking Kits */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Package className="h-4 w-4 text-muted-foreground" />
                Deployed tracking kits
              </CardTitle>
              <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => setShowDeployWizard(true)}>
                <Plus className="h-3 w-3 mr-1" />
                Add pack
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {deployments.length === 0 ? (
              <div className="py-6 text-center">
                <p className="text-xs text-muted-foreground">No tracking kits deployed yet.</p>
                <Button size="sm" variant="outline" className="mt-3 text-xs" onClick={() => setShowDeployWizard(true)}>
                  Deploy a pack
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {deployments.map((dep) => (
                  <div key={dep.id} className="flex items-center justify-between rounded-lg border px-3 py-2.5">
                    <div>
                      <p className="text-xs font-medium">{dep.pack?.name ?? 'Unknown Pack'}</p>
                      <p className="text-xs text-muted-foreground">
                        {dep.pack?.business_type} · v{dep.pack?.version ?? 1}
                        {dep.last_generated_at && ` · Generated ${new Date(dep.last_generated_at).toLocaleDateString()}`}
                      </p>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-red-600"
                      onClick={() => handleRemoveDeployment(dep.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Platform Configuration */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Platform Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            {client.platforms.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">No platforms configured.</p>
            ) : (
              <div className="space-y-1.5">
                {client.platforms.filter((p) => p.is_active).map((p) => (
                  <div key={p.id} className="flex items-center justify-between text-xs">
                    <span className="font-medium uppercase text-muted-foreground">{p.platform}</span>
                    <span className="font-mono text-muted-foreground/70">
                      {p.measurement_id ?? '— not set'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Generated Outputs */}
      {Object.keys(latestOutputsByType).length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-semibold">Latest Outputs</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {Object.values(latestOutputsByType).map((output) => (
              <Card key={output.id}>
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{OUTPUT_ICONS[output.output_type] ?? '📁'}</span>
                    <div>
                      <p className="text-xs font-medium">{OUTPUT_LABELS[output.output_type]}</p>
                      <p className="text-xs text-muted-foreground">
                        v{output.version} · {new Date(output.generated_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <a
                    href={clientApi.downloadOutputUrl(orgId!, clientId!, output.id)}
                    download
                    className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent"
                  >
                    <Download className="h-3 w-3" />
                    Download
                  </a>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {showDeployWizard && orgId && (
        <DeploymentWizard
          orgId={orgId}
          clientId={clientId!}
          clientName={client.name}
          onDeployed={(dep) => {
            setDeployments((d) => [...d, dep]);
            setShowDeployWizard(false);
          }}
          onClose={() => setShowDeployWizard(false)}
        />
      )}
    </div>
  );
}
