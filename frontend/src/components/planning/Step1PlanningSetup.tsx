import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { usePlanningStore } from '@/store/planningStore';
import type { BusinessType, Platform } from '@/types/planning';

const BUSINESS_TYPES: { value: BusinessType; label: string; description: string }[] = [
  { value: 'ecommerce',  label: 'E-commerce',    description: 'Online store with products and checkout' },
  { value: 'saas',       label: 'SaaS',          description: 'Software subscription or free trial' },
  { value: 'lead_gen',   label: 'Lead Gen',      description: 'Forms, demos, or contact requests' },
  { value: 'other',      label: 'Other',         description: 'Other business model' },
];

const PLATFORMS: { value: Platform; label: string; icon: string }[] = [
  { value: 'ga4',        label: 'Google Analytics 4',       icon: '📊' },
  { value: 'google_ads', label: 'Google Ads',               icon: '🎯' },
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

export function Step1PlanningSetup() {
  const { draftSetup, updateDraftSetup, nextStep } = usePlanningStore();

  const [url, setUrl] = useState(draftSetup.website_url ?? '');
  const [businessType, setBusinessType] = useState<BusinessType>(draftSetup.business_type ?? 'ecommerce');
  const [description, setDescription] = useState(draftSetup.business_description ?? '');
  const [platforms, setPlatforms] = useState<Platform[]>(draftSetup.selected_platforms ?? ['ga4', 'google_ads']);
  const [urlError, setUrlError] = useState('');

  function togglePlatform(p: Platform) {
    setPlatforms((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]);
  }

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

  return (
    <div className="mx-auto max-w-xl px-6 py-10">
      <h2 className="mb-1 text-xl font-bold">Tell us about your website</h2>
      <p className="mb-8 text-sm text-muted-foreground">
        Atlas will scan your pages and recommend exactly what to track for your business goals.
      </p>

      <div className="mb-6 space-y-1.5">
        <Label htmlFor="website-url">
          Website URL <span className="text-destructive">*</span>
        </Label>
        <Input
          id="website-url"
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={() => url && validateUrl(url)}
          placeholder="https://yourstore.com"
          className={urlError ? 'border-destructive' : ''}
        />
        {urlError && <p className="text-xs text-destructive">{urlError}</p>}
      </div>

      <div className="mb-6">
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
                  : 'border-border hover:border-border/80 hover:bg-muted/40'
              )}
            >
              <div className="text-sm font-medium">{label}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="mb-6 space-y-1.5">
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

      <div className="mb-8">
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
                  : 'border-border hover:border-border/60'
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
