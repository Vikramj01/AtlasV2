import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { FunnelType, Region } from '@/types/audit';
import { useAudit } from '@/hooks/useAudit';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const FUNNEL_OPTIONS: { value: FunnelType; label: string }[] = [
  { value: 'ecommerce', label: 'Ecommerce (Cart → Checkout → Confirmation)' },
  { value: 'saas',      label: 'SaaS (Trial → Onboarding → Subscription)' },
  { value: 'lead_gen',  label: 'Lead Gen (Landing → Form → Thank You)' },
];

const REGION_OPTIONS: { value: Region; label: string }[] = [
  { value: 'us',     label: 'United States' },
  { value: 'eu',     label: 'Europe (GDPR)' },
  { value: 'global', label: 'Global' },
];

// Step URL fields per funnel type
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

  const [funnelType, setFunnelType] = useState<FunnelType>('ecommerce');
  const [region, setRegion] = useState<Region>('us');
  const [urlMap, setUrlMap] = useState<Record<string, string>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [testPhone, setTestPhone] = useState('');

  const steps = FUNNEL_STEPS[funnelType];

  const handleFunnelChange = (next: FunnelType) => {
    setFunnelType(next);
    setUrlMap({});
  };

  const handleUrlChange = (key: string, value: string) => {
    setUrlMap((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const websiteUrl = urlMap['landing'] ?? '';
    const auditId = await startAudit({
      website_url: websiteUrl,
      funnel_type: funnelType,
      region,
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
          We'll simulate a real user journey and validate every conversion signal.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Funnel Type */}
          <div className="space-y-1.5">
            <Label>Funnel Type</Label>
            <Select value={funnelType} onValueChange={(v) => handleFunnelChange(v as FunnelType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FUNNEL_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Per-step URLs */}
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium">Journey URLs</p>
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
          </div>

          {/* Region */}
          <div className="space-y-1.5">
            <Label>Region <span className="text-muted-foreground">(optional)</span></Label>
            <Select value={region} onValueChange={(v) => setRegion(v as Region)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REGION_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Advanced Settings */}
          <div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-brand-600 hover:text-brand-700 px-0"
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

          <Button type="submit" disabled={loading} className="w-full bg-brand-600 hover:bg-brand-700">
            {loading ? 'Starting audit…' : 'Run Signal Audit'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
