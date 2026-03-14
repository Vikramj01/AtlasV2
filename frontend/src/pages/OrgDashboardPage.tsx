import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Users, Building2, Zap, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { organisationApi, clientApi } from '@/lib/api/organisationApi';
import { useOrganisationStore } from '@/store/organisationStore';
import { ClientCard } from '@/components/organisation/ClientCard';
import type { Organisation } from '@/types/organisation';

export function OrgDashboardPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { clients, setClients } = useOrganisationStore();
  const [org, setOrg] = useState<Organisation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) return;
    setIsLoading(true);
    Promise.all([
      organisationApi.get(orgId),
      clientApi.list(orgId),
    ])
      .then(([orgData, clientData]) => {
        setOrg(orgData);
        setClients(clientData);
      })
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [orgId, setClients]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-sm text-red-600 bg-red-50 rounded-lg">{error}</div>
    );
  }

  const healthyClients = clients.filter((c) => c.signal_health !== null && c.signal_health >= 80).length;
  const atRiskClients = clients.filter((c) => c.signal_health !== null && c.signal_health < 60).length;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{org?.name ?? 'Organisation'}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {org?.member_count ?? 0} members · {org?.client_count ?? clients.length} clients
          </p>
        </div>
        <Link to={`/org/${orgId}/clients`}>
          <Button size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            Add client
          </Button>
        </Link>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-50">
              <Zap className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{healthyClients}</p>
              <p className="text-xs text-muted-foreground">Healthy clients</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-50">
              <Building2 className="h-5 w-5 text-red-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{atRiskClients}</p>
              <p className="text-xs text-muted-foreground">At-risk clients</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{org?.member_count ?? 0}</p>
              <p className="text-xs text-muted-foreground">Team members</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick links */}
      <div className="flex gap-3 flex-wrap">
        <Link to={`/org/${orgId}/signals`}>
          <Button variant="outline" size="sm">Signal Library</Button>
        </Link>
        <Link to={`/org/${orgId}/packs`}>
          <Button variant="outline" size="sm">Signal Packs</Button>
        </Link>
        <Link to={`/org/${orgId}/settings`}>
          <Button variant="outline" size="sm">Team & Settings</Button>
        </Link>
      </div>

      {/* Client list */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Clients</h2>
          <Link to={`/org/${orgId}/clients`} className="text-xs text-muted-foreground hover:text-foreground">
            View all →
          </Link>
        </div>

        {clients.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Building2 className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm font-medium text-muted-foreground">No clients yet</p>
              <p className="mt-1 text-xs text-muted-foreground/70">
                Add your first client to start deploying signal packs.
              </p>
              <Link to={`/org/${orgId}/clients`}>
                <Button size="sm" className="mt-4">Add first client</Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {clients.slice(0, 9).map((client) => (
              <ClientCard key={client.id} client={client} orgId={orgId!} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
