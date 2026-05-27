import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Plus, Search, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { clientApi } from '@/lib/api/organisationApi';
import { useOrganisationStore } from '@/store/organisationStore';
import { ClientCard } from '@/components/organisation/ClientCard';
import { ClientSetupWizard } from '@/components/organisation/ClientSetupWizard';
import { SkeletonCard } from '@/components/common/SkeletonCard';
import type { ClientWithDetails, BusinessType, OrgClientSummary } from '@/types/organisation';

type SortKey = 'name' | 'created_at' | 'health';

const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  ecommerce: 'Ecommerce',
  saas: 'SaaS',
  lead_gen: 'Lead Gen',
  content: 'Content',
  marketplace: 'Marketplace',
  custom: 'Custom',
};

export function ClientListPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { clients, setClients, addClient } = useOrganisationStore();
  const [isLoading, setIsLoading] = useState(true);
  const [summary, setSummary] = useState<OrgClientSummary | null>(null);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [filterType, setFilterType] = useState<BusinessType | 'all'>('all');
  const [showFilters, setShowFilters] = useState(false);
  const [showWizard, setShowWizard] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    Promise.all([
      clientApi.list(orgId),
      clientApi.summary(orgId).catch(() => null),
    ]).then(([clientList, summaryData]) => {
      setClients(clientList);
      setSummary(summaryData);
    }).finally(() => setIsLoading(false));
  }, [orgId, setClients]);

  const activeBusinessTypes = [...new Set(clients.map((c) => c.business_type))];

  const filtered = clients
    .filter((c) => {
      const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.website_url.toLowerCase().includes(search.toLowerCase());
      const matchesType = filterType === 'all' || c.business_type === filterType;
      return matchesSearch && matchesType;
    })
    .sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name);
      if (sortKey === 'health') {
        const aScore = a.signal_health ?? -1;
        const bScore = b.signal_health ?? -1;
        return bScore - aScore;
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  function handleClientCreated(client: ClientWithDetails) {
    addClient(client);
    setShowWizard(false);
    // Refresh summary
    if (orgId) clientApi.summary(orgId).then(setSummary).catch(() => null);
  }

  function handleTemplateSaved() {
    if (orgId) clientApi.summary(orgId).then(setSummary).catch(() => null);
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

      {/* Summary stats */}
      {!isLoading && summary && summary.total_clients > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border bg-white px-4 py-3">
            <p className="text-xs text-muted-foreground">Total clients</p>
            <p className="text-xl font-bold mt-0.5">{summary.total_clients}</p>
          </div>
          <div className="rounded-lg border bg-white px-4 py-3">
            <p className="text-xs text-muted-foreground">With signal packs</p>
            <p className="text-xl font-bold mt-0.5">{summary.clients_with_deployments}</p>
          </div>
          <div className="rounded-lg border bg-white px-4 py-3">
            <p className="text-xs text-muted-foreground">Agency templates</p>
            <p className="text-xl font-bold mt-0.5">{summary.agency_template_packs}</p>
          </div>
        </div>
      )}

      {/* Search + filters */}
      {clients.length > 3 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search clients…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 shrink-0"
              onClick={() => setShowFilters((s) => !s)}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filter
            </Button>
          </div>

          {showFilters && (
            <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground font-medium">Type:</span>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setFilterType('all')}
                    className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                      filterType === 'all'
                        ? 'border-primary bg-primary/10 text-primary font-medium'
                        : 'border-border text-muted-foreground hover:border-foreground/40'
                    }`}
                  >
                    All
                  </button>
                  {activeBusinessTypes.map((bt) => (
                    <button
                      key={bt}
                      type="button"
                      onClick={() => setFilterType(bt)}
                      className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                        filterType === bt
                          ? 'border-primary bg-primary/10 text-primary font-medium'
                          : 'border-border text-muted-foreground hover:border-foreground/40'
                      }`}
                    >
                      {BUSINESS_TYPE_LABELS[bt] ?? bt}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2 ml-auto">
                <span className="text-xs text-muted-foreground font-medium">Sort:</span>
                <div className="flex gap-1.5">
                  {([['name', 'Name'], ['created_at', 'Newest'], ['health', 'Health']] as const).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSortKey(key)}
                      className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                        sortKey === key
                          ? 'border-primary bg-primary/10 text-primary font-medium'
                          : 'border-border text-muted-foreground hover:border-foreground/40'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {isLoading ? (
        <SkeletonCard variant="page" />
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {search || filterType !== 'all'
              ? 'No clients match your filters.'
              : 'No clients yet. Add your first client to get started.'}
          </p>
          {!search && filterType === 'all' && (
            <Button size="sm" className="mt-4" onClick={() => setShowWizard(true)}>
              Add first client
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((client) => (
            <ClientCard
              key={client.id}
              client={client}
              orgId={orgId!}
              onTemplateSaved={handleTemplateSaved}
            />
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
