import { useState, useEffect } from 'react';
import { Copy, Layers, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { clientApi } from '@/lib/api/organisationApi';
import { signalApi } from '@/lib/api/signalApi';
import { enrichmentApi } from '@/lib/api/enrichmentApi';
import { cn } from '@/lib/utils';
import { IdentityConfigStep } from '@/components/enrichment/IdentityConfigStep';
import type { ClientWithDetails, BusinessType, PlatformKey } from '@/types/organisation';
import type { SignalPack } from '@/types/signal';

const TOTAL_STEPS = 6;

type StartingMode = 'scratch' | 'copy_client' | 'use_pack';

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

  // Step 1: Starting point
  const [startingMode, setStartingMode] = useState<StartingMode>('scratch');
  const [sourceClientId, setSourceClientId] = useState('');
  const [sourcePackId, setSourcePackId] = useState('');
  const [existingClients, setExistingClients] = useState<ClientWithDetails[]>([]);
  const [agencyTemplatePacks, setAgencyTemplatePacks] = useState<SignalPack[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);

  // Step 2: Client details
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [businessType, setBusinessType] = useState<BusinessType | ''>('');
  const [primaryConversionObjective, setPrimaryConversionObjective] = useState('');
  const [hasOfflineConversions, setHasOfflineConversions] = useState<boolean | null>(null);

  // Step 3: Platforms
  const [platformIds, setPlatformIds] = useState<Partial<Record<PlatformKey, string>>>({});

  // Step 4: Pages
  const [pages, setPages] = useState([
    { label: 'Home', url: '', page_type: 'home', stage_order: 1 },
    { label: 'Product', url: '', page_type: 'product', stage_order: 2 },
    { label: 'Cart', url: '', page_type: 'cart', stage_order: 3 },
    { label: 'Checkout', url: '', page_type: 'checkout', stage_order: 4 },
    { label: 'Confirmation', url: '', page_type: 'confirmation', stage_order: 5 },
  ]);

  // Created client (set after step 3, used for identity config in step 4)
  const [createdClientId, setCreatedClientId] = useState<string | null>(null);

  // Submit state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load existing clients and agency template packs when wizard opens
  useEffect(() => {
    setLoadingOptions(true);
    Promise.all([
      clientApi.list(orgId).catch(() => [] as ClientWithDetails[]),
      signalApi.listPacks(orgId).catch(() => [] as SignalPack[]),
    ]).then(([clientList, packList]) => {
      setExistingClients(clientList);
      setAgencyTemplatePacks(packList.filter((p) => p.is_agency_template));
    }).finally(() => setLoadingOptions(false));
  }, [orgId]);

  function addProductPage() {
    setPages((pp) => {
      const lastProductIdx = pp.reduce((last, p, i) => p.page_type === 'product' ? i : last, -1);
      const inserted = [
        ...pp.slice(0, lastProductIdx + 1),
        { label: 'Product', url: '', page_type: 'product', stage_order: 0 },
        ...pp.slice(lastProductIdx + 1),
      ];
      return inserted.map((p, i) => ({ ...p, stage_order: i + 1 }));
    });
  }

  function removeProductPage(idx: number) {
    setPages((pp) => {
      const updated = pp.filter((_, i) => i !== idx);
      return updated.map((p, i) => ({ ...p, stage_order: i + 1 }));
    });
  }

  const step1Valid =
    startingMode === 'scratch' ||
    (startingMode === 'copy_client' && !!sourceClientId) ||
    (startingMode === 'use_pack' && !!sourcePackId);

  // Create the client record and platforms when advancing from step 3 → step 4.
  // Pages are saved at final finish so the user can still edit them in step 5.
  async function handleAdvanceToIdentityStep() {
    if (createdClientId) { setStep(4); return; }
    setIsSubmitting(true);
    setError(null);
    try {
      const client = await clientApi.create(orgId, {
        name,
        website_url: url,
        business_type: businessType as BusinessType,
        auto_detect: true,
        primary_conversion_objective: primaryConversionObjective.trim() || undefined,
        apply_pack_id: startingMode === 'use_pack' ? sourcePackId : undefined,
        copy_signals_from_client_id: startingMode === 'copy_client' ? sourceClientId : undefined,
      });

      const activePlatforms = PLATFORM_FIELDS
        .filter((f) => platformIds[f.key]?.trim())
        .map((f) => ({ platform: f.key, is_active: true, measurement_id: platformIds[f.key]!.trim() }));
      if (activePlatforms.length > 0) {
        await clientApi.setPlatforms(orgId, client.id, activePlatforms);
      }

      setCreatedClientId(client.id);
      setStep(4);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create client');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleFinish() {
    if (!createdClientId) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const validPages = pages.filter((p) => p.url.trim());
      if (validPages.length > 0) {
        await clientApi.setPages(orgId, createdClientId, validPages);
      }
      const client = await clientApi.get(orgId, createdClientId);
      onCreated({ ...client, platforms: client.platforms ?? [], pages: validPages as ClientWithDetails['pages'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to finalise client');
    } finally {
      setIsSubmitting(false);
    }
  }

  const startingModeOptions: Array<{ mode: StartingMode; icon: React.ReactNode; title: string; description: string; available: boolean }> = [
    {
      mode: 'scratch',
      icon: <Sparkles className="h-4 w-4" />,
      title: 'Start from scratch',
      description: 'Build this client\'s tracking setup from the ground up.',
      available: true,
    },
    {
      mode: 'copy_client',
      icon: <Copy className="h-4 w-4" />,
      title: 'Copy from a client',
      description: 'Clone an existing client\'s signal pack configuration.',
      available: existingClients.length > 0,
    },
    {
      mode: 'use_pack',
      icon: <Layers className="h-4 w-4" />,
      title: 'Use an agency template',
      description: 'Apply a saved template pack from your signal library.',
      available: agencyTemplatePacks.length > 0,
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-lg">
        <CardContent className="p-6">
          {/* Progress */}
          <div className="mb-6 flex items-center gap-2">
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
              <div
                key={i}
                className={cn(
                  'h-1.5 flex-1 rounded-full transition-colors',
                  i + 1 <= step ? 'bg-primary' : 'bg-muted',
                )}
              />
            ))}
          </div>

          {/* Step 1: Starting point */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-bold">Starting point</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  How would you like to set up this client&apos;s tracking?
                </p>
              </div>

              {loadingOptions ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {startingModeOptions.map((opt) => (
                    <button
                      key={opt.mode}
                      type="button"
                      disabled={!opt.available}
                      onClick={() => { if (opt.available) setStartingMode(opt.mode); }}
                      className={cn(
                        'w-full rounded-lg border p-3 text-left transition-all',
                        startingMode === opt.mode
                          ? 'border-primary bg-primary/5 ring-1 ring-primary'
                          : 'border-border hover:border-foreground/30',
                        !opt.available && 'opacity-40 cursor-not-allowed',
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 text-muted-foreground">{opt.icon}</span>
                        <div>
                          <p className="text-sm font-medium">{opt.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Source client picker */}
              {startingMode === 'copy_client' && existingClients.length > 0 && (
                <div className="space-y-1">
                  <Label className="text-xs">Copy settings from</Label>
                  <select
                    value={sourceClientId}
                    onChange={(e) => setSourceClientId(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">Select a client…</option>
                    {existingClients.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Agency template pack picker */}
              {startingMode === 'use_pack' && agencyTemplatePacks.length > 0 && (
                <div className="space-y-1">
                  <Label className="text-xs">Apply template pack</Label>
                  <select
                    value={sourcePackId}
                    onChange={(e) => setSourcePackId(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">Select a template…</option>
                    {agencyTemplatePacks.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Client details */}
          {step === 2 && (
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
                <Label className="text-xs">
                  Business type <span className="text-red-500">*</span>
                </Label>
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
              <div className="space-y-2">
                <Label className="text-xs">
                  Does this client have physical retail locations or a sales team closing deals offline?
                </Label>
                <div className="flex gap-2">
                  {([true, false] as const).map((val) => (
                    <button
                      key={String(val)}
                      type="button"
                      onClick={() => setHasOfflineConversions(val)}
                      className={cn(
                        'flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
                        hasOfflineConversions === val
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:border-foreground hover:text-foreground',
                      )}
                    >
                      {val ? 'Yes' : 'No'}
                    </button>
                  ))}
                </div>
                {hasOfflineConversions && (
                  <p className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-3 py-2">
                    When you deploy signals for this client, set the <strong>Event Source</strong> to{' '}
                    <em>Physical Store</em> or <em>System Generated</em> for offline conversion signals. This
                    controls Meta&apos;s <code className="text-[11px]">action_source</code> and Google&apos;s DMA{' '}
                    <code className="text-[11px]">eventSource</code>, which determines attribution windows (62–90 days
                    vs. 7 days for online events).
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <Label htmlFor="primary-objective" className="text-xs">
                  Primary conversion objective <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Textarea
                  id="primary-objective"
                  placeholder="e.g. Form submissions from enterprise prospects, demo bookings, trial signups"
                  value={primaryConversionObjective}
                  onChange={(e) => setPrimaryConversionObjective(e.target.value.slice(0, 500))}
                  className="text-xs resize-none"
                  rows={2}
                />
                <p className="text-right text-[10px] text-muted-foreground">
                  {primaryConversionObjective.length}/500
                </p>
              </div>
            </div>
          )}

          {/* Step 3: Platform IDs */}
          {step === 3 && (
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

          {/* Step 4: Identity Configuration */}
          {step === 4 && createdClientId && (
            <IdentityConfigStep
              clientId={createdClientId}
              initialConfig={null}
              onSave={async (req) => {
                await enrichmentApi.saveIdentityConfig(orgId, createdClientId, req);
                setStep(5);
              }}
              onSkip={() => setStep(5)}
              mode="wizard"
              onValidatePath={(path) =>
                enrichmentApi.validateFieldPath(orgId, createdClientId, { field_path: path })
              }
            />
          )}

          {/* Step 5: Page URLs */}
          {step === 5 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-bold">Page URLs</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Add the URLs for each funnel stage. Used for audits and output generation.
                </p>
              </div>
              <div className="space-y-2">
                {(() => {
                  const productPages = pages.filter((p) => p.page_type === 'product');
                  let productCounter = 0;
                  return pages.map((page, idx) => {
                    const isProduct = page.page_type === 'product';
                    if (isProduct) productCounter++;
                    const isLastProduct = isProduct && productCounter === productPages.length;
                    const displayLabel = isProduct && productPages.length > 1
                      ? `Product ${productCounter}`
                      : page.label;
                    return (
                      <div key={idx}>
                        <div className="flex items-center gap-2">
                          <span className="w-24 shrink-0 text-xs text-muted-foreground">{displayLabel}</span>
                          <Input
                            placeholder={`https://…/${page.page_type}`}
                            value={page.url}
                            onChange={(e) => setPages((pp) => pp.map((p, i) => i === idx ? { ...p, url: e.target.value } : p))}
                            className="text-xs"
                          />
                          {isProduct && productPages.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeProductPage(idx)}
                              className="shrink-0 text-base leading-none text-muted-foreground hover:text-red-500"
                              aria-label="Remove product URL"
                            >
                              ×
                            </button>
                          )}
                        </div>
                        {isLastProduct && (
                          <button
                            type="button"
                            onClick={addProductPage}
                            className="mt-1.5 ml-[6.5rem] text-xs text-primary hover:underline"
                          >
                            + Add another product URL
                          </button>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          )}

          {/* Step 6: Review */}
          {step === 6 && (
            <div className="space-y-4">
              <h2 className="text-base font-bold">Review & create</h2>
              <div className="space-y-2 rounded-lg border p-4 text-xs">
                {startingMode !== 'scratch' && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Starting point</span>
                    <span className="font-medium">
                      {startingMode === 'copy_client'
                        ? `Copied from ${existingClients.find((c) => c.id === sourceClientId)?.name ?? 'client'}`
                        : `Template: ${agencyTemplatePacks.find((p) => p.id === sourcePackId)?.name ?? 'pack'}`}
                    </span>
                  </div>
                )}
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
                {primaryConversionObjective.trim() && (
                  <div className="flex flex-col gap-0.5">
                    <span className="text-muted-foreground">Primary objective</span>
                    <span className="font-medium text-right">{primaryConversionObjective.trim()}</span>
                  </div>
                )}
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
                {hasOfflineConversions !== null && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Offline conversions</span>
                    <span className="font-medium">{hasOfflineConversions ? 'Yes' : 'No'}</span>
                  </div>
                )}
              </div>
              {hasOfflineConversions && (
                <div className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-3 py-2">
                  <strong>Reminder:</strong> When deploying signals, set Event Source to{' '}
                  <em>Physical Store</em> or <em>System Generated</em> for offline conversions to get the
                  correct 62–90 day attribution window on Meta and Google.
                </div>
              )}
              {error && (
                <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
              )}
            </div>
          )}

          {/* Nav buttons — hidden on step 4 (IdentityConfigStep has its own buttons) */}
          {step !== 4 && (
            <div className="mt-6 flex justify-between">
              <Button variant="ghost" onClick={step === 1 ? onClose : () => setStep((s) => (s - 1) as typeof step)}>
                {step === 1 ? 'Cancel' : '← Back'}
              </Button>
              {step < TOTAL_STEPS ? (
                <Button
                  onClick={step === 3 ? handleAdvanceToIdentityStep : () => setStep((s) => (s + 1) as typeof step)}
                  disabled={
                    (step === 1 && !step1Valid) ||
                    (step === 2 && (!name.trim() || !url.trim() || !businessType)) ||
                    (step === 3 && isSubmitting)
                  }
                >
                  {step === 3 && isSubmitting ? 'Creating…' : 'Next →'}
                </Button>
              ) : (
                <Button onClick={handleFinish} disabled={isSubmitting}>
                  {isSubmitting ? 'Saving…' : 'Finish'}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
