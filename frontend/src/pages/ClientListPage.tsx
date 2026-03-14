import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { clientApi } from '@/lib/api/organisationApi';
import { useOrganisationStore } from '@/store/organisationStore';
import { ClientCard } from '@/components/organisation/ClientCard';
import { ClientSetupWizard } from '@/components/organisation/ClientSetupWizard';
import type { ClientWithDetails } from '@/types/organisation';

export function ClientListPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { clients, setClients, addClient } = useOrganisationStore();
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showWizard, setShowWizard] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    clientApi.list(orgId)
      .then(setClients)
      .finally(() => setIsLoading(false));
  }, [orgId, setClients]);

  const filtered = clients.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.website_url.toLowerCase().includes(search.toLowerCase()),
  );

  function handleClientCreated(client: ClientWithDetails) {
    addClient(client);
    setShowWizard(false);
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Clients</h1>
        <Button size="sm" className="gap-2" onClick={() => setShowWizard(true)}>
          <Plus className="h-4 w-4" />
          Add client
        </Button>
      </div>

      {clients.length > 4 && (
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search clients…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {search ? 'No clients match your search.' : 'No clients yet. Add your first client to get started.'}
          </p>
          {!search && (
            <Button size="sm" className="mt-4" onClick={() => setShowWizard(true)}>
              Add first client
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((client) => (
            <ClientCard key={client.id} client={client} orgId={orgId!} />
          ))}
        </div>
      )}

      {showWizard && orgId && (
        <ClientSetupWizard
          orgId={orgId}
          onCreated={handleClientCreated}
          onClose={() => setShowWizard(false)}
        />
      )}
    </div>
  );
}
