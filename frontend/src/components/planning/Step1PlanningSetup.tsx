import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { usePlanningStore } from '@/store/planningStore';
import type { BusinessType, Platform, SiteDetection } from '@/types/planning';

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
  } = usePlanningStore();

  // Phase: 'url-entry' | 'detected' | 'manual-fallback'
  type Phase = 'url-entry' | 'detected' | 'manual-fallback';
  const [phase, setPhase] = useState<Phase>('url-entry');

  const [url, setUrl] = useState(draftSetup.website_url ?? '');
  const [urlError, setUrlError] = useState('');

  // Form fields (populated from detection or entered manually)
  const [businessType, setBusinessType] = useState<BusinessType>(draftSetup.business_type ?? 'ecommerce');
  const [description, setDescription] = useState(draftSetup.business_description ?? '');
  const [platforms, setPlatforms] = useState<Platform[]>(draftSetup.selected_platforms ?? ['ga4', 'google_ads']);

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

  function handleContinue() {
    if (!validateUrl(url)) return;
    if (platforms.length === 0) return;

    updateDraftSetup({
      website_url: normalizeUrl(url),
      business_type: businessType,
      business_description: description || undefined,
      selected_platforms: platforms,
    });

    nextStep();
  }

  // ── State 1: URL entry ────────────────────────────────────────────────────

  if (phase === 'url-entry') {
    return (
      <div className="mx-auto max-w-xl px-6 py-16">
        <h2 className="mb-2 text-xl font-bold">What's your website URL?</h2>
        <p className="mb-8 text-sm text-muted-foreground">
          Atlas will scan your site and pre-fill everything for you.
        </p>

        <div className="flex gap-2">
          <Input
            type="text"
            value={url}
            onChange={(e) => { setUrl(e.target.value); setUrlError(''); }}
            onKeyDown={handleUrlKeyDown}
            placeholder="https://yourstore.com"
            className={cn('flex-1', urlError ? 'border-destructive' : '')}
            autoFocus
          />
          <Button
            onClick={handleScan}
            disabled={detectionLoading || !url.trim()}
            className="bg-brand-600 hover:bg-brand-700 shrink-0"
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
          className="mt-4 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Fill in manually instead
        </button>
      </div>
    );
  }

  // ── State 2: Detection results / manual fallback ──────────────────────────

  const isManual = phase === 'manual-fallback';
  const tracking = siteDetection?.existing_tracking;

  return (
    <div className="mx-auto max-w-xl px-6 py-10">
      {/* Detection result banner */}
      {siteDetection && !isManual && (
        <div className="mb-6 rounded-lg border border-green-200 bg-green-50 p-4">
          <p className="text-sm font-medium text-green-800">
            Site detected: {siteDetection.site_title}
            {siteDetection.detected_platform && (
              <span className="ml-1 text-green-700">
                ({siteDetection.detected_platform.name.charAt(0).toUpperCase() + siteDetection.detected_platform.name.slice(1)})
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-green-700">
            Review the pre-filled details below and click Continue.
          </p>
        </div>
      )}

      {/* Manual fallback banner */}
      {isManual && (
        <div className="mb-6 rounded-lg border border-amber-100 bg-amber-50 p-4">
          <p className="text-sm text-amber-800">
            We couldn't scan your site automatically. Please fill in the details below.
          </p>
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
            className={cn('flex-1', urlError ? 'border-destructive' : '')}
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
                  ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500'
                  : 'border-border hover:border-border/80 hover:bg-muted/40',
              )}
            >
              <div className="text-sm font-medium">{label}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Platforms */}
      <div className="mb-5">
        <Label className="mb-1.5 block">
          Ad & analytics platforms <span className="text-destructive">*</span>
        </Label>
        <p className="mb-2 text-xs text-muted-foreground">Select all that you use or plan to use.</p>
        <div className="flex flex-col gap-2">
          {PLATFORMS.map(({ value, label, icon }) => (
            <label
              key={value}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors',
                platforms.includes(value)
                  ? 'border-brand-500 bg-brand-50'
                  : 'border-border hover:border-border/60',
              )}
            >
              <input
                type="checkbox"
                checked={platforms.includes(value)}
                onChange={() => togglePlatform(value)}
                className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
              />
              <span className="text-base" aria-hidden="true">{icon}</span>
              <span className="text-sm font-medium">{label}</span>
            </label>
          ))}
        </div>
        {platforms.length === 0 && (
          <p className="mt-1.5 text-xs text-destructive">Select at least one platform.</p>
        )}
      </div>

      {/* Description */}
      <div className="mb-8 space-y-1.5">
        <Label htmlFor="description">
          Business description{' '}
          <span className="text-xs font-normal text-muted-foreground">(optional — helps AI tailor recommendations)</span>
        </Label>
        <Textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="e.g. We sell handmade jewellery via Shopify, targeting women 25–45."
        />
      </div>

      <div className="flex justify-end">
        <Button
          onClick={handleContinue}
          disabled={platforms.length === 0}
          className="bg-brand-600 hover:bg-brand-700"
        >
          Continue →
        </Button>
      </div>
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
    <div className="flex items-center justify-between rounded border border-border px-3 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {detected ? (
        <span className="flex items-center gap-1.5 text-green-700">
          <span className="text-xs">✓</span>
          <span className="text-xs font-medium">{id ? id : 'Detected'}</span>
        </span>
      ) : (
        <span className="text-xs text-muted-foreground/60">Not detected</span>
      )}
    </div>
  );
}
