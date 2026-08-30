import { useState, useEffect } from 'react';
import type * as React from 'react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { usePlanningStore } from '@/store/planningStore';
import { useShallow } from 'zustand/react/shallow';
import { useOrganisationStore } from '@/store/organisationStore';
import { clientApi } from '@/lib/api/organisationApi';
import type { BusinessType, Platform, SiteDetection } from '@/types/planning';
import type { ClientWithDetails } from '@/types/organisation';

const BUSINESS_TYPES: { value: BusinessType; label: string; description: string }[] = [
  { value: 'ecommerce', label: 'E-commerce',  description: 'Online store with products and checkout' },
  { value: 'saas',      label: 'SaaS',        description: 'Software subscription or free trial' },
  { value: 'lead_gen',  label: 'Lead Gen',    description: 'Forms, demos, or contact requests' },
  { value: 'other',     label: 'Other',       description: 'Other business model' },
];

const PLATFORMS: { value: Platform; label: string; icon: string }[] = [
  { value: 'ga4',        label: 'Google Analytics 4',        icon: '📊' },
  { value: 'google_ads', label: 'Google Ads',                icon: '🎯' },
  { value: 'meta',       label: 'Meta (Facebook/Instagram)', icon: '📘' },
  { value: 'tiktok',     label: 'TikTok Ads',               icon: '🎵' },
  { value: 'sgtm',       label: 'Server-side GTM',          icon: '🖥️' },
];

// Radix Select items can't have an empty-string value, so use a sentinel
// for the "no client" option and translate it back to '' at the call site.
const NO_CLIENT = '__none__';

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  return `https://${trimmed}`;
}

function inferBusinessType(detection: SiteDetection): BusinessType {
  const t = detection.inferred_business_type;
  if (t === 'ecommerce') return 'ecommerce';
  if (t === 'saas') return 'saas';
  if (t === 'lead_gen') return 'lead_gen';
  return 'other';
}

function inferPlatforms(detection: SiteDetection): Platform[] {
  const platforms: Platform[] = [];
  if (detection.existing_tracking.ga4_detected) platforms.push('ga4');
  if (detection.existing_tracking.google_ads_detected) platforms.push('google_ads');
  if (detection.existing_tracking.meta_pixel_detected) platforms.push('meta');
  if (detection.existing_tracking.tiktok_detected) platforms.push('tiktok');
  // Default to GA4 if nothing detected
  if (platforms.length === 0) platforms.push('ga4', 'google_ads');
  return platforms;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function Step1PlanningSetup() {
  const {
    draftSetup,
    updateDraftSetup,
    nextStep,
    siteDetection,
    detectionLoading,
    detectionError,
    runDetection,
    clearDetection,
  } = usePlanningStore(useShallow((s) => ({
    draftSetup: s.draftSetup,
    updateDraftSetup: s.updateDraftSetup,
    nextStep: s.nextStep,
    siteDetection: s.siteDetection,
    detectionLoading: s.detectionLoading,
    detectionError: s.detectionError,
    runDetection: s.runDetection,
    clearDetection: s.clearDetection,
  })));

  // Phase: 'url-entry' | 'detected' | 'manual-fallback'
  type Phase = 'url-entry' | 'detected' | 'manual-fallback';
  const [phase, setPhase] = useState<Phase>('url-entry');

  const [url, setUrl] = useState(draftSetup.website_url ?? '');
  const [urlError, setUrlError] = useState('');

  // Form fields (populated from detection or entered manually)
  const [businessType, setBusinessType] = useState<BusinessType>(draftSetup.business_type ?? 'ecommerce');
  const [description, setDescription] = useState(draftSetup.business_description ?? '');
  const [platforms, setPlatforms] = useState<Platform[]>(draftSetup.selected_platforms ?? ['ga4', 'google_ads']);
  const [secondaryDomains, setSecondaryDomains] = useState<string[]>(draftSetup.secondary_domains ?? []);
  const [domainInput, setDomainInput] = useState('');

  // Client selector (org context)
  const { organisations, currentOrg } = useOrganisationStore();
  const [orgClients, setOrgClients] = useState<ClientWithDetails[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>(draftSetup.client_id ?? '');
  const activeOrgId = currentOrg?.id ?? organisations[0]?.id;

  useEffect(() => {
    if (!activeOrgId) return;
    clientApi.list(activeOrgId)
      .then(setOrgClients)
      .catch(() => { /* non-blocking */ });
  }, [activeOrgId]);

  function handleClientSelect(rawClientId: string) {
    const clientId = rawClientId === NO_CLIENT ? '' : rawClientId;
    setSelectedClientId(clientId);
    if (!clientId) return;
    const client = orgClients.find((c) => c.id === clientId);
    if (!client) return;
    // Pre-fill URL and business type from the client record
    setUrl(client.website_url);
    setUrlError('');
    const bt = client.business_type as BusinessType;
    if (['ecommerce', 'saas', 'lead_gen'].includes(bt)) {
      setBusinessType(bt);
    }
    // If we were on URL-entry phase, jump to manual-fallback so fields are visible
    setPhase('manual-fallback');
    clearDetection();
  }

  // When detection completes, populate form fields
  useEffect(() => {
    if (siteDetection) {
      setBusinessType(inferBusinessType(siteDetection));
      setPlatforms(inferPlatforms(siteDetection));
      setPhase('detected');
    }
  }, [siteDetection]);

  // If detection errored, fall back to manual
  useEffect(() => {
    if (detectionError) {
      setPhase('manual-fallback');
    }
  }, [detectionError]);

  function validateUrl(raw: string): boolean {
    const normalized = normalizeUrl(raw);
    if (!normalized) { setUrlError('Please enter your website URL.'); return false; }
    try {
      new URL(normalized);
      setUrlError('');
      return true;
    } catch {
      setUrlError('Please enter a valid URL (e.g. https://example.com).');
      return false;
    }
  }

  async function handleScan() {
    if (!validateUrl(url)) return;
    clearDetection();
    await runDetection(normalizeUrl(url));
  }

  function handleUrlKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') handleScan();
  }

  function handleManualFallback() {
    setPhase('manual-fallback');
    clearDetection();
  }

  function togglePlatform(p: Platform) {
    setPlatforms((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]);
  }

  function addDomain() {
    const trimmed = domainInput.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!trimmed || secondaryDomains.includes(trimmed)) { setDomainInput(''); return; }
    setSecondaryDomains((prev) => [...prev, trimmed]);
    setDomainInput('');
  }

  function removeDomain(domain: string) {
    setSecondaryDomains((prev) => prev.filter((d) => d !== domain));
  }

  function handleDomainKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); addDomain(); }
  }

  function handleContinue() {
    if (!validateUrl(url)) return;
    if (platforms.length === 0) return;

    updateDraftSetup({
      website_url: normalizeUrl(url),
      business_type: businessType,
      business_description: description || undefined,
      selected_platforms: platforms,
      secondary_domains: secondaryDomains,
      client_id: selectedClientId || undefined,
    });

    nextStep();
  }

  // ── State 1: URL entry ────────────────────────────────────────────────────

  if (phase === 'url-entry') {
    return (
      <div className="mx-auto max-w-xl px-6 py-16">
        <h2 className="mb-2 font-display text-xl text-console-fg">What's your website URL?</h2>
        <p className="mb-8 text-sm text-console-fg-subtle">
          Atlas will scan your site and pre-fill everything for you.
        </p>

        {/* Client selector — only shown when user belongs to an org */}
        {orgClients.length > 0 && (
          <div className="mb-6 space-y-1.5">
            <Label htmlFor="client-select">Link to a client <span className="text-xs font-normal text-console-fg-subtle">(optional)</span></Label>
            <Select value={selectedClientId || NO_CLIENT} onValueChange={handleClientSelect}>
              <SelectTrigger id="client-select">
                <SelectValue placeholder="— Personal / no client —" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CLIENT}>— Personal / no client —</SelectItem>
                {orgClients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name} ({c.website_url})</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-console-fg-subtle">Selecting a client pre-fills the URL and business type.</p>
          </div>
        )}

        <div className="flex gap-2">
          <Input
            type="text"
            value={url}
            onChange={(e) => { setUrl(e.target.value); setUrlError(''); }}
            onKeyDown={handleUrlKeyDown}
            placeholder="https://yourstore.com"
            className={cn('flex-1 font-mono', urlError ? 'border-destructive' : '')}
            autoFocus
          />
          <Button
            onClick={handleScan}
            disabled={detectionLoading || !url.trim()}
            className="bg-console-primary hover:bg-console-primary-hover shrink-0"
          >
            {detectionLoading ? (
              <span className="flex items-center gap-2">
                <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Scanning…
              </span>
            ) : 'Scan'}
          </Button>
        </div>

        {urlError && <p className="mt-1.5 text-xs text-destructive">{urlError}</p>}

        <button
          type="button"
          onClick={handleManualFallback}
          className="mt-4 text-xs text-console-fg-subtle underline underline-offset-2 hover:text-console-fg"
        >
          Fill in manually instead
        </button>
      </div>
    );
  }

  // ── State 2: Detection results / manual fallback ──────────────────────────

  const isManual = phase === 'manual-fallback';
  const tracking = siteDetection?.existing_tracking;
  const selectedBusinessType = BUSINESS_TYPES.find((b) => b.value === businessType);
  const selectedClient = orgClients.find((c) => c.id === selectedClientId);

  return (
    <div className="flex justify-center gap-8 px-6 py-10">
      <div className="w-full max-w-xl">
        {/* Detection result banner */}
        {siteDetection && !isManual && (
          <div className="mb-6 rounded-lg border border-console-green/20 bg-console-green/[0.04] p-4">
            <p className="text-sm font-medium text-console-green">
              Site detected: {siteDetection.site_title}
              {siteDetection.detected_platform && (
                <span className="ml-1 text-console-green/80">
                  ({siteDetection.detected_platform.name.charAt(0).toUpperCase() + siteDetection.detected_platform.name.slice(1)})
                </span>
              )}
            </p>
            <p className="mt-0.5 text-xs text-console-green/80">
              Review the pre-filled details below and click Continue.
            </p>
          </div>
        )}

        {/* Manual fallback banner */}
        {isManual && (
          <div className="mb-6 rounded-lg border border-console-amber/20 bg-console-amber/[0.04] p-4">
            <p className="text-sm text-console-amber">
              We couldn't scan your site automatically. Please fill in the details below.
            </p>
          </div>
        )}

        {/* Client selector — only shown when user belongs to an org */}
        {orgClients.length > 0 && (
          <div className="mb-5 space-y-1.5">
            <Label htmlFor="client-select-form">Linked client <span className="text-xs font-normal text-console-fg-subtle">(optional)</span></Label>
            <Select value={selectedClientId || NO_CLIENT} onValueChange={handleClientSelect}>
              <SelectTrigger id="client-select-form">
                <SelectValue placeholder="— Personal / no client —" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CLIENT}>— Personal / no client —</SelectItem>
                {orgClients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name} ({c.website_url})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* URL field (editable) */}
        <div className="mb-5 space-y-1.5">
          <Label htmlFor="website-url">
            Website URL <span className="text-destructive">*</span>
          </Label>
          <div className="flex gap-2">
            <Input
              id="website-url"
              type="text"
              value={url}
              onChange={(e) => { setUrl(e.target.value); setUrlError(''); }}
              placeholder="https://yourstore.com"
              className={cn('flex-1 font-mono', urlError ? 'border-destructive' : '')}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => { clearDetection(); setPhase('url-entry'); }}
              className="shrink-0 text-xs"
            >
              Change
            </Button>
          </div>
          {urlError && <p className="text-xs text-destructive">{urlError}</p>}
        </div>

        {/* Existing tracking (from detection) */}
        {tracking && (
          <div className="mb-5">
            <Label className="mb-2 block">Tracking detected on your site</Label>
            <div className="space-y-1.5">
              <TrackingRow
                label="Google Analytics 4"
                detected={tracking.ga4_detected}
                id={tracking.ga4_measurement_id}
              />
              <TrackingRow
                label="Google Tag Manager"
                detected={tracking.gtm_detected}
                id={tracking.gtm_container_id}
              />
              <TrackingRow
                label="Meta Pixel"
                detected={tracking.meta_pixel_detected}
                id={tracking.meta_pixel_id}
              />
              <TrackingRow
                label="Google Ads"
                detected={tracking.google_ads_detected}
              />
              <TrackingRow
                label="TikTok Ads"
                detected={tracking.tiktok_detected}
              />
              <TrackingRow
                label="LinkedIn"
                detected={tracking.linkedin_detected}
              />
            </div>
          </div>
        )}

        {/* Business type */}
        <div className="mb-5">
          <Label className="mb-1.5 block">
            Business type <span className="text-destructive">*</span>
          </Label>
          <div className="grid grid-cols-2 gap-2">
            {BUSINESS_TYPES.map(({ value, label, description: desc }) => (
              <button
                key={value}
                type="button"
                onClick={() => setBusinessType(value)}
                className={cn(
                  'rounded-lg border p-3 text-left transition-colors',
                  businessType === value
                    ? 'border-console-primary bg-console-primary/[0.06] ring-1 ring-console-primary'
                    : 'border-console-border hover:border-console-fg-subtle hover:bg-console-chip',
                )}
              >
                <div className="text-sm font-medium text-console-fg">{label}</div>
                <div className="mt-0.5 text-xs text-console-fg-subtle">{desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Platforms */}
        <div className="mb-5">
          <Label className="mb-1.5 block">
            Ad & analytics platforms <span className="text-destructive">*</span>
          </Label>
          <p className="mb-2 text-xs text-console-fg-subtle">Select all that you use or plan to use.</p>
          <div className="flex flex-col gap-2">
            {PLATFORMS.map(({ value, label, icon }) => (
              <label
                key={value}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors',
                  platforms.includes(value)
                    ? 'border-console-primary bg-console-primary/[0.06]'
                    : 'border-console-border hover:border-console-fg-subtle/60',
                )}
              >
                <Checkbox
                  checked={platforms.includes(value)}
                  onCheckedChange={() => togglePlatform(value)}
                />
                <span className="text-base" aria-hidden="true">{icon}</span>
                <span className="text-sm font-medium text-console-fg">{label}</span>
              </label>
            ))}
          </div>
          {platforms.length === 0 && (
            <p className="mt-1.5 text-xs text-destructive">Select at least one platform.</p>
          )}
        </div>

        {/* Description */}
        <div className="mb-5 space-y-1.5">
          <Label htmlFor="description">
            Business description{' '}
            <span className="text-xs font-normal text-console-fg-subtle">(optional — helps AI tailor recommendations)</span>
          </Label>
          <Textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="e.g. We sell handmade jewellery via Shopify, targeting women 25–45."
          />
        </div>

        {/* Cross-domain tracking */}
        <div className="mb-8 space-y-1.5">
          <Label>
            Secondary domains{' '}
            <span className="text-xs font-normal text-console-fg-subtle">(optional — for cross-domain tracking)</span>
          </Label>
          <p className="text-xs text-console-fg-subtle">
            If users move to a separate domain during this journey (e.g. a checkout subdomain), add those domains here. Atlas will configure GA4 cross-domain linking automatically.
          </p>
          <div className="flex gap-2">
            <Input
              type="text"
              value={domainInput}
              onChange={(e) => setDomainInput(e.target.value)}
              onKeyDown={handleDomainKeyDown}
              placeholder="checkout.example.com"
              className="h-8 text-sm font-mono"
            />
            <Button type="button" size="sm" variant="outline" onClick={addDomain} className="shrink-0">
              Add
            </Button>
          </div>
          {secondaryDomains.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {secondaryDomains.map((d) => (
                <span key={d} className="flex items-center gap-1 rounded-full border border-console-primary/30 bg-console-primary/[0.06] px-2.5 py-0.5 font-mono text-xs font-medium text-console-primary">
                  {d}
                  <button type="button" onClick={() => removeDomain(d)} className="ml-0.5 text-console-primary/60 hover:text-console-primary" aria-label={`Remove ${d}`}>×</button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <Button
            onClick={handleContinue}
            disabled={platforms.length === 0}
            className="bg-console-primary hover:bg-console-primary-hover"
          >
            Continue →
          </Button>
        </div>
      </div>

      {/* Configuration draft — live preview of what this setup will produce */}
      <aside className="hidden w-[300px] shrink-0 lg:block">
        <div className="sticky top-6 rounded-lg border border-console-border bg-console-surface">
          <div className="border-b border-console-border p-5">
            <h3 className="font-heading text-sm font-semibold text-console-fg">Configuration Draft</h3>
            {selectedClient && (
              <p className="mt-0.5 text-xs text-console-fg-subtle">{selectedClient.name}</p>
            )}
          </div>
          <div className="flex flex-col gap-5 p-5">
            <div className="flex flex-col gap-1.5">
              <span className="font-heading text-[11px] font-semibold uppercase tracking-[0.1em] text-console-fg-subtle">Target Origin</span>
              <div className="rounded border border-console-border bg-console-chip px-3 py-2 font-mono text-xs text-console-fg">
                {url.trim() ? normalizeUrl(url).replace(/^https?:\/\//, '') : '—'}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="font-heading text-[11px] font-semibold uppercase tracking-[0.1em] text-console-fg-subtle">Inferred Entity</span>
              <span className="text-sm font-medium text-console-fg">{selectedBusinessType?.label ?? '—'}</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="font-heading text-[11px] font-semibold uppercase tracking-[0.1em] text-console-fg-subtle">Active Platforms</span>
              {platforms.length === 0 ? (
                <span className="text-xs text-console-fg-disabled">None selected yet</span>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {platforms.map((p) => {
                    const platform = PLATFORMS.find((x) => x.value === p);
                    return (
                      <li key={p} className="flex items-center justify-between rounded border border-console-border bg-console-chip px-3 py-1.5 text-sm">
                        <span className="text-console-fg">{platform?.label ?? p}</span>
                        <span className="rounded-full bg-console-amber/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-console-amber">PENDING</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

// ── Helper component ──────────────────────────────────────────────────────────

function TrackingRow({
  label,
  detected,
  id,
}: {
  label: string;
  detected: boolean;
  id?: string | null;
}) {
  return (
    <div className="flex items-center justify-between rounded border border-console-border px-3 py-2 text-sm">
      <span className="text-console-fg-subtle">{label}</span>
      {detected ? (
        <span className="flex items-center gap-1.5 text-console-green">
          <span className="text-xs">✓</span>
          <span className="font-mono text-xs font-medium">{id ? id : 'Detected'}</span>
        </span>
      ) : (
        <span className="text-xs text-console-fg-disabled">Not detected</span>
      )}
    </div>
  );
}
