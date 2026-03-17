/**
 * PackDeploymentView
 *
 * Shows which clients within an org have a given signal pack deployed,
 * with staleness status (outputs up-to-date vs needs regeneration).
 *
 * Fetches from GET /api/signals/packs/:id/deployments?org_id=:orgId
 *
 * Used inside PackDetailPage below the signals grid.
 *
 * Sprint 3 — Deployments & Output Generation
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, XCircle, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { signalApi } from '@/lib/api/signalApi';
import type { PackDeploymentClient } from '@/types/signal';

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? '1 month ago' : `${months} months ago`;
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ client }: { client: PackDeploymentClient }) {
  if (!client.last_generated_at) {
    return (
      <span className="flex items-center gap-1 text-xs text-orange-600">
        <XCircle className="h-3.5 w-3.5 shrink-0" />
        Never generated
      </span>
    );
  }
  if (client.is_outdated) {
    return (
      <span className="flex items-center gap-1 text-xs text-amber-600">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        Outputs outdated
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-xs text-green-600">
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
      Up to date
    </span>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

interface Props {
  packId: string;
  orgId: string;
}

export function PackDeploymentView({ packId, orgId }: Props) {
  const [deployments, setDeployments] = useState<PackDeploymentClient[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    signalApi
      .getPackDeployments(packId, orgId)
      .then(setDeployments)
      .catch((err: Error) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [packId, orgId]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Deployed to clients</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading && (
          <div className="flex justify-center py-6">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
          </div>
        )}

        {error && (
          <p className="text-xs text-red-600 py-2">{error}</p>
        )}

        {!isLoading && !error && deployments.length === 0 && (
          <div className="py-6 text-center">
            <p className="text-sm text-muted-foreground">No clients are using this pack yet.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Open a client and use <strong>Deploy Pack</strong> to assign this pack.
            </p>
          </div>
        )}

        {!isLoading && deployments.length > 0 && (
          <div className="divide-y">
            {deployments.map((d) => (
              <div key={d.deployment_id} className="flex items-center justify-between py-2.5 gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-medium truncate">{d.client_name}</p>
                    <Link
                      to={`/org/${d.org_id}/clients/${d.client_id}`}
                      className="text-muted-foreground hover:text-foreground"
                      title="Open client"
                    >
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </Link>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Deployed {relativeDate(d.deployed_at)}
                    {d.last_generated_at && (
                      <> · Generated {relativeDate(d.last_generated_at)}</>
                    )}
                  </p>
                </div>
                <StatusBadge client={d} />
              </div>
            ))}
          </div>
        )}

        {/* Summary footer */}
        {!isLoading && deployments.length > 1 && (
          <div className="mt-3 pt-3 border-t flex items-center justify-between text-xs text-muted-foreground">
            <span>{deployments.length} clients total</span>
            <span>
              {deployments.filter((d) => d.is_outdated || !d.last_generated_at).length} need regeneration
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
