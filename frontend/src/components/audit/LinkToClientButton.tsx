import { useEffect, useState } from 'react';
import { Link2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { clientApi } from '@/lib/api/organisationApi';
import { auditApi } from '@/lib/api/auditApi';
import { useOrganisationStore } from '@/store/organisationStore';
import type { ClientWithDetails } from '@/types/organisation';

interface Props {
  auditId: string;
}

/**
 * Lets a bare-URL evaluation (run with no client selected) be attached to an
 * existing client afterward, from the report view — the "link later" half of
 * the Evaluate-a-site flow.
 */
export function LinkToClientButton({ auditId }: Props) {
  const currentOrg = useOrganisationStore((s) => s.currentOrg);
  const [open, setOpen] = useState(false);
  const [clients, setClients] = useState<ClientWithDetails[]>([]);
  const [loadingClients, setLoadingClients] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linked, setLinked] = useState(false);

  useEffect(() => {
    if (!open || !currentOrg) return;
    setLoadingClients(true);
    clientApi.list(currentOrg.id)
      .then(setClients)
      .catch(() => setClients([]))
      .finally(() => setLoadingClients(false));
  }, [open, currentOrg]);

  async function handleLink() {
    if (!selectedClientId) return;
    setSaving(true);
    setError(null);
    try {
      await auditApi.linkToClient(auditId, selectedClientId);
      setLinked(true);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to link client');
    } finally {
      setSaving(false);
    }
  }

  if (!currentOrg) return null;

  return (
    <>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        {linked ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
        {linked ? 'Linked to client' : 'Link to a client'}
      </Button>

      <Dialog open={open} onOpenChange={(v) => { if (!saving) setOpen(v); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Link this evaluation to a client</DialogTitle>
            <DialogDescription>
              Attach this report to an existing client so it shows up in their history.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Select
              value={selectedClientId}
              onValueChange={setSelectedClientId}
              disabled={loadingClients || clients.length === 0}
            >
              <SelectTrigger>
                <SelectValue placeholder={loadingClients ? 'Loading clients…' : 'Select a client…'} />
              </SelectTrigger>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!loadingClients && clients.length === 0 && (
              <p className="mt-2 text-xs text-muted-foreground">No clients yet in this workspace.</p>
            )}
            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleLink} disabled={saving || !selectedClientId}>
              {saving ? 'Linking…' : 'Link'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
