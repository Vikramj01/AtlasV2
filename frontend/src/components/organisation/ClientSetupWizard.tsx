/**
 * ClientSetupWizard — 4-step modal wizard for onboarding a new client.
 * Steps: 1) Name & URL  2) Site detection  3) Platform IDs  4) Page URLs
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { clientApi } from '@/lib/api/organisationApi';
import type { ClientWithDetails, BusinessType, PlatformKey } from '@/types/organisation';

const BUSINESS_TYPES: { value: BusinessType; label: string }[] = [
  { value: 'ecommerce', label: 'Ecommerce' },
  { value: 'saas', label: 'SaaS' },
  { value: 'lead_gen', label: 'Lead Generation' },
  { value: 'content', label: 'Content / Media' },
  { value: 'marketplace', label: 'Marketplace' },
  { value: 'custom', label: 'Custom' },
];

const PLATFORM_FIELDS: { key: PlatformKey; label: string; placeholder: string }[] = [
  { key: 'ga4', label: 'GA4 Measurement ID', placeholder: 'G-XXXXXXXXXX' },
  { key: 'google_ads', label: 'Google Ads Conversion ID', placeholder: 'AW-XXXXXXXXXX/YYYYYY' },
  { key: 'meta', label: 'Meta Pixel ID', placeholder: '1234567890' },
  { key: 'sgtm', label: 'Server-side GTM Endpoint', placeholder: 'https://gtm.yourdomain.com' },
];

interface Props {
  orgId: string;
  onCreated: (client: ClientWithDetails) => void;
  onClose: () => void;
}

export function ClientSetupWizard({ orgId, onCreated, onClose }: Props) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [businessType, setBusinessType] = useState<BusinessType>('ecommerce');
  const [platformIds, setPlatformIds] = useState<Partial<Record<PlatformKey, string>>>({});
  const [pages, setPages] = useState([
    { label: 'Home', url: '', page_type: 'home', stage_order: 1 },
    { label: 'Product', url: '', page_type: 'product', stage_order: 2 },
    { label: 'Cart', url: '', page_type: 'cart', stage_order: 3 },
    { label: 'Checkout', url: '', page_type: 'checkout', stage_order: 4 },
    { label: 'Confirmation', url: '', page_type: 'confirmation', stage_order: 5 },
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFinish() {
    setIsSubmitting(true);
    setError(null);
    try {
      const client = await clientApi.create(orgId, { name, website_url: url, business_type: businessType, auto_detect: true });

      // Save platform IDs
      const activePlatforms = PLATFORM_FIELDS
        .filter((f) => platformIds[f.key]?.trim())
        .map((f) => ({ platform: f.key, is_active: true, measurement_id: platformIds[f.key]!.trim() }));
      if (activePlatforms.length > 0) {
        await clientApi.setPlatforms(orgId, client.id, activePlatforms);
      }

      // Save pages
      const validPages = pages.filter((p) => p.url.trim());
      if (validPages.length > 0) {
        await clientApi.setPages(orgId, client.id, validPages);
      }

      onCreated({ ...client, platforms: [], pages: validPages as ClientWithDetails['pages'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create client');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-lg">
        <CardContent className="p-6">
          {/* Progress */}
          <div className="mb-6 flex items-center gap-2">
            {[1, 2, 3, 4].map((s) => (
              <div
                key={s}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  s <= step ? 'bg-primary' : 'bg-muted'
                }`}
              />
            ))}
          </div>

          {/* Step 1: Name & URL */}
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-base font-bold">Client details</h2>
              <div className="space-y-1">
                <Label htmlFor="client-name" className="text-xs">Client name</Label>
                <Input id="client-name" placeholder="Acme Furniture" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="client-url" className="text-xs">Website URL</Label>
                <Input id="client-url" placeholder="https://acmefurniture.com" value={url} onChange={(e) => setUrl(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Business type</Label>
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
            </div>
          )}

          {/* Step 2: Platform IDs */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-bold">Platform IDs</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  These will be injected into generated outputs. You can add them later.
                </p>
              </div>
              {PLATFORM_FIELDS.map((f) => (
                <div key={f.key} className="space-y-1">
                  <Label htmlFor={`plat-${f.key}`} className="text-xs">{f.label}</Label>
                  <Input
                    id={`plat-${f.key}`}
                    placeholder={f.placeholder}
                    value={platformIds[f.key] ?? ''}
                    onChange={(e) => setPlatformIds((p) => ({ ...p, [f.key]: e.target.value }))}
                    className="font-mono text-xs"
                  />
                </div>
              ))}
            </div>
          )}

          {/* Step 3: Page URLs */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-bold">Page URLs</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Add the URLs for each funnel stage. Used for audits and output generation.
                </p>
              </div>
              <div className="space-y-2">
                {pages.map((page, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="w-24 shrink-0 text-xs text-muted-foreground">{page.label}</span>
                    <Input
                      placeholder={`https://…/${page.page_type}`}
                      value={page.url}
                      onChange={(e) => setPages((pp) => pp.map((p, i) => i === idx ? { ...p, url: e.target.value } : p))}
                      className="text-xs"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 4: Review */}
          {step === 4 && (
            <div className="space-y-4">
              <h2 className="text-base font-bold">Review & create</h2>
              <div className="space-y-2 rounded-lg border p-4 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Client name</span>
                  <span className="font-medium">{name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Website</span>
                  <span className="font-medium truncate max-w-[200px]">{url}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Business type</span>
                  <span className="font-medium capitalize">{businessType}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Platforms configured</span>
                  <span className="font-medium">
                    {PLATFORM_FIELDS.filter((f) => platformIds[f.key]?.trim()).length || 'None yet'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Pages added</span>
                  <span className="font-medium">
                    {pages.filter((p) => p.url.trim()).length || 'None yet'}
                  </span>
                </div>
              </div>
              {error && (
                <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
              )}
            </div>
          )}

          {/* Nav buttons */}
          <div className="mt-6 flex justify-between">
            <Button variant="ghost" onClick={step === 1 ? onClose : () => setStep((s) => s - 1)}>
              {step === 1 ? 'Cancel' : '← Back'}
            </Button>
            {step < 4 ? (
              <Button onClick={() => setStep((s) => s + 1)} disabled={step === 1 && (!name.trim() || !url.trim())}>
                Next →
              </Button>
            ) : (
              <Button onClick={handleFinish} disabled={isSubmitting}>
                {isSubmitting ? 'Creating…' : 'Create client'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
