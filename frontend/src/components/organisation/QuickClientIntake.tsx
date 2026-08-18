import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { clientApi } from '@/lib/api/organisationApi';
import { useOrganisationStore } from '@/store/organisationStore';
import type { BusinessType } from '@/types/organisation';

const BUSINESS_TYPES: { value: BusinessType; label: string }[] = [
  { value: 'ecommerce', label: 'Ecommerce' },
  { value: 'saas', label: 'SaaS' },
  { value: 'lead_gen', label: 'Lead Generation' },
  { value: 'content', label: 'Content / Media' },
  { value: 'marketplace', label: 'Marketplace' },
  { value: 'custom', label: 'Custom' },
];

interface Props {
  orgId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Slim client intake — name, URL, business type only. Everything else
 * (platform IDs, identity config, funnel pages) is deferred to the client's
 * tracking hub / Enrichment tab, surfaced after the scan rather than upfront.
 * On success, drops the user straight into the AI site scan instead of back
 * to the client list — see ClientSetupWizard for the full advanced flow.
 */
export function QuickClientIntake({ orgId, open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const { addClient } = useOrganisationStore();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [businessType, setBusinessType] = useState<BusinessType | ''>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = name.trim() && url.trim() && businessType;

  function reset() {
    setName('');
    setUrl('');
    setBusinessType('');
    setError(null);
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const client = await clientApi.create(orgId, {
        name: name.trim(),
        website_url: url.trim(),
        business_type: businessType as BusinessType,
        auto_detect: true,
      });
      addClient({ ...client, platforms: [], pages: [] });
      reset();
      onOpenChange(false);
      navigate(`/planning/new?client_id=${client.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create client');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!isSubmitting) { onOpenChange(v); if (!v) reset(); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Set up a new client</DialogTitle>
          <DialogDescription>
            We'll create the client and take you straight into the AI site scan. You can fill in
            platform IDs, identity mapping, and funnel pages afterward.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="quick-client-name">Client name</Label>
            <Input
              id="quick-client-name"
              placeholder="Acme Furniture"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="quick-client-url">Website URL</Label>
            <Input
              id="quick-client-url"
              placeholder="https://acmefurniture.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Business type</Label>
            <div className="flex flex-wrap gap-2">
              {BUSINESS_TYPES.map((bt) => (
                <button
                  key={bt.value}
                  type="button"
                  onClick={() => setBusinessType(bt.value)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    businessType === bt.value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:border-foreground hover:text-foreground'
                  }`}
                >
                  {bt.label}
                </button>
              ))}
            </div>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting || !canSubmit}>
            {isSubmitting ? 'Creating…' : 'Create & scan'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
