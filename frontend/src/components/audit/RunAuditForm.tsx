import { useState } from 'react';
import type * as React from 'react';

import { useNavigate } from 'react-router-dom';
import type { FunnelType, SiteType, SecondaryMotion, DeclaredPlatform, TrafficRegion, CMP } from '@/types/audit';
import { useAudit } from '@/hooks/useAudit';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MultiChipToggle } from '@/components/audit/MultiChipToggle';
import {
  SITE_TYPE_OPTIONS, SECONDARY_MOTION_OPTIONS, DECLARED_PLATFORM_OPTIONS,
  TRAFFIC_REGION_OPTIONS, CMP_OPTIONS, MONTHLY_SPEND_BAND_OPTIONS,
  SITE_TYPE_TO_FUNNEL_TYPE, SITE_TYPES_USING_BORROWED_TEMPLATE,
} from '@/lib/scanInputOptions';

// Step URL fields per (legacy) journey template — see SITE_TYPE_TO_FUNNEL_TYPE
// for which site types currently borrow which template.
const FUNNEL_STEPS: Record<FunnelType, { key: string; label: string; placeholder: string; required: boolean }[]> = {
  ecommerce: [
    { key: 'landing',      label: 'Landing / Home URL',      placeholder: 'https://your-store.com',                        required: true },
    { key: 'product',      label: 'Product Page URL',        placeholder: 'https://your-store.com/products/example',       required: true },
    { key: 'checkout',     label: 'Checkout Page URL',       placeholder: 'https://your-store.com/checkout',               required: true },
    { key: 'confirmation', label: 'Order Confirmation URL',  placeholder: 'https://your-store.com/order-confirmation',     required: true },
  ],
  saas: [
    { key: 'landing',     label: 'Landing / Home URL',  placeholder: 'https://your-app.com',                required: true },
    { key: 'signup',      label: 'Sign-up Page URL',    placeholder: 'https://your-app.com/signup',         required: true },
    { key: 'onboarding',  label: 'Onboarding Page URL', placeholder: 'https://your-app.com/onboarding',     required: false },
  ],
  lead_gen: [
    { key: 'landing',   label: 'Landing Page URL',   placeholder: 'https://your-site.com/offer',     required: true },
    { key: 'thank_you', label: 'Thank-You Page URL', placeholder: 'https://your-site.com/thank-you', required: true },
  ],
};

export function RunAuditForm() {
  const navigate = useNavigate();
  const { startAudit, loading, error } = useAudit();

  // 1. Site type
  const [siteType, setSiteType] = useState<SiteType>('ecommerce');
  const [secondaryMotion, setSecondaryMotion] = useState<SecondaryMotion>('none');
  // 2. Ad platforms
  const [declaredPlatforms, setDeclaredPlatforms] = useState<DeclaredPlatform[]>([]);
  const [primaryChannel, setPrimaryChannel] = useState<DeclaredPlatform | ''>('');
  const [spendBand, setSpendBand] = useState('');
  // 3. Regions
  const [trafficRegions, setTrafficRegions] = useState<TrafficRegion[]>(['us']);
  const [cmp, setCmp] = useState<CMP | ''>('');
  // 4. Domains
  const [urlMap, setUrlMap] = useState<Record<string, string>>({});
  const [productDomain, setProductDomain] = useState('');
  const [checkoutDomain, setCheckoutDomain] = useState('');

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [testPhone, setTestPhone] = useState('');

  const funnelTemplate = SITE_TYPE_TO_FUNNEL_TYPE[siteType];
  const steps = FUNNEL_STEPS[funnelTemplate];
  const usesBorrowedTemplate = SITE_TYPES_USING_BORROWED_TEMPLATE.has(siteType);

  const handleSiteTypeChange = (next: SiteType) => {
    setSiteType(next);
    setUrlMap({});
  };

  const handlePlatformsChange = (next: DeclaredPlatform[]) => {
    setDeclaredPlatforms(next);
    if (!next.includes(primaryChannel as DeclaredPlatform)) {
      setPrimaryChannel(next[0] ?? '');
    }
  };

  const handleUrlChange = (key: string, value: string) => {
    setUrlMap((prev) => ({ ...prev, [key]: value }));
  };

  const canSubmit =
    !!urlMap['landing'] && declaredPlatforms.length > 0 && !!primaryChannel && trafficRegions.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!primaryChannel) return;
    const websiteUrl = urlMap['landing'] ?? '';
    const auditId = await startAudit({
      website_url: websiteUrl,
      site_type: siteType,
      secondary_motion: secondaryMotion,
      declared_platforms: declaredPlatforms,
      primary_channel: primaryChannel,
      monthly_spend_band: spendBand || undefined,
      traffic_regions: trafficRegions,
      cmp: cmp || undefined,
      product_domain: productDomain.trim() || websiteUrl,
      checkout_domain: checkoutDomain.trim() || undefined,
      url_map: urlMap,
      test_email: testEmail || undefined,
      test_phone: testPhone || undefined,
    });
    if (auditId) navigate(`/audit/${auditId}/progress`);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Run a Conversion Signal Audit</CardTitle>
        <CardDescription>
          We'll simulate a real user journey and validate every conversion signal against the Check Register.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* ── 1. Site type ─────────────────────────────────────────────── */}
          <div className="space-y-3">
            <p className="text-sm font-medium">1. Site type</p>
            <div className="space-y-1.5">
              <Label>Primary business model</Label>
              <Select value={siteType} onValueChange={(v) => handleSiteTypeChange(v as SiteType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SITE_TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {usesBorrowedTemplate && (
                <p className="text-xs text-muted-foreground">
                  Journey steps below use the closest existing template ({funnelTemplate}) — a dedicated{' '}
                  {SITE_TYPE_OPTIONS.find((o) => o.value === siteType)?.label} template is coming.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Secondary motion <span className="text-muted-foreground">(optional)</span></Label>
              <Select value={secondaryMotion} onValueChange={(v) => setSecondaryMotion(v as SecondaryMotion)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SECONDARY_MOTION_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* ── 2. Ad platforms ──────────────────────────────────────────── */}
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium">2. Ad platforms</p>
              <p className="text-xs text-muted-foreground">
                Only declared platforms are scored — everything else reports Out of Scope, not Broken.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Declared platforms</Label>
              <MultiChipToggle
                options={DECLARED_PLATFORM_OPTIONS}
                selected={declaredPlatforms}
                onChange={handlePlatformsChange}
              />
            </div>
            {declaredPlatforms.length > 0 && (
              <div className="space-y-1.5">
                <Label>Primary channel</Label>
                <Select value={primaryChannel} onValueChange={(v) => setPrimaryChannel(v as DeclaredPlatform)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DECLARED_PLATFORM_OPTIONS.filter((o) => declaredPlatforms.includes(o.value)).map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Monthly spend band <span className="text-muted-foreground">(optional)</span></Label>
              <Select value={spendBand} onValueChange={setSpendBand}>
                <SelectTrigger>
                  <SelectValue placeholder="Not specified" />
                </SelectTrigger>
                <SelectContent>
                  {MONTHLY_SPEND_BAND_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* ── 3. Regions ────────────────────────────────────────────────── */}
          <div className="space-y-3">
            <p className="text-sm font-medium">3. Regions</p>
            <div className="space-y-1.5">
              <Label>Traffic regions</Label>
              <MultiChipToggle
                options={TRAFFIC_REGION_OPTIONS}
                selected={trafficRegions}
                onChange={setTrafficRegions}
              />
            </div>
            <div className="space-y-1.5">
              <Label>CMP in use <span className="text-muted-foreground">(optional)</span></Label>
              <Select value={cmp} onValueChange={(v) => setCmp(v as CMP)}>
                <SelectTrigger>
                  <SelectValue placeholder="Not specified" />
                </SelectTrigger>
                <SelectContent>
                  {CMP_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* ── 4. Domains — journey URLs + product/checkout domain ─────────── */}
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium">4. Domains &amp; journey URLs</p>
              <p className="text-xs text-muted-foreground">
                Enter each page in the funnel so we can simulate the full user journey.
              </p>
            </div>
            {steps.map((step) => (
              <div key={step.key} className="space-y-1.5">
                <Label>
                  {step.label}
                  {!step.required && <span className="ml-1 text-muted-foreground">(optional)</span>}
                </Label>
                <Input
                  type="url"
                  value={urlMap[step.key] ?? ''}
                  onChange={(e) => handleUrlChange(step.key, e.target.value)}
                  required={step.required}
                  placeholder={step.placeholder}
                />
              </div>
            ))}
            <div className="space-y-1.5">
              <Label>
                Product / app domain <span className="text-muted-foreground">(optional — defaults to marketing domain)</span>
              </Label>
              <Input
                type="url"
                value={productDomain}
                onChange={(e) => setProductDomain(e.target.value)}
                placeholder="https://app.your-site.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Checkout / billing host <span className="text-muted-foreground">(optional)</span></Label>
              <Input
                type="url"
                value={checkoutDomain}
                onChange={(e) => setCheckoutDomain(e.target.value)}
                placeholder="https://checkout.stripe.com"
              />
            </div>
          </div>

          {/* Advanced Settings */}
          <div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-[#1B2A4A] hover:text-[#1B2A4A] px-0"
            >
              {showAdvanced ? '▲ Hide' : '▼ Advanced settings'}
            </Button>

            {showAdvanced && (
              <div className="mt-3 space-y-3 rounded-lg border bg-muted/40 p-4">
                <div className="space-y-1.5">
                  <Label>
                    Test email <span className="text-muted-foreground">(for enhanced conversions)</span>
                  </Label>
                  <Input
                    type="email"
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                    placeholder="test@example.com"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>
                    Test phone <span className="text-muted-foreground">(for Meta CAPI)</span>
                  </Label>
                  <Input
                    type="tel"
                    value={testPhone}
                    onChange={(e) => setTestPhone(e.target.value)}
                    placeholder="+1 555 000 0000"
                  />
                </div>
              </div>
            )}
          </div>

          {error && (
            <p className="rounded-lg bg-destructive/10 px-4 py-2.5 text-sm text-destructive">{error}</p>
          )}

          <Button type="submit" disabled={loading || !canSubmit} className="w-full bg-[#1B2A4A] hover:bg-[#1B2A4A]">
            {loading ? 'Starting audit…' : 'Run Signal Audit'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
