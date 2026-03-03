import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { FunnelType, Region } from '@/types/audit';
import { useAudit } from '@/hooks/useAudit';

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
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-900">Run a Conversion Signal Audit</h2>
      <p className="mt-1 text-sm text-gray-500">
        We'll simulate a real user journey and validate every conversion signal.
      </p>

      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        {/* Funnel Type */}
        <div>
          <label className="block text-sm font-medium text-gray-700">Funnel Type</label>
          <select
            value={funnelType}
            onChange={(e) => handleFunnelChange(e.target.value as FunnelType)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none"
          >
            {FUNNEL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* Per-step URLs */}
        <div className="space-y-3">
          <p className="text-sm font-medium text-gray-700">Journey URLs</p>
          <p className="text-xs text-gray-500 -mt-2">
            Enter each page in the funnel so we can simulate the full user journey.
          </p>
          {steps.map((step) => (
            <div key={step.key}>
              <label className="block text-sm font-medium text-gray-700">
                {step.label}
                {!step.required && <span className="ml-1 text-gray-400">(optional)</span>}
              </label>
              <input
                type="url"
                value={urlMap[step.key] ?? ''}
                onChange={(e) => handleUrlChange(step.key, e.target.value)}
                required={step.required}
                placeholder={step.placeholder}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none"
              />
            </div>
          ))}
        </div>

        {/* Region */}
        <div>
          <label className="block text-sm font-medium text-gray-700">Region <span className="text-gray-400">(optional)</span></label>
          <select
            value={region}
            onChange={(e) => setRegion(e.target.value as Region)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none"
          >
            {REGION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* Advanced Settings */}
        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-sm text-brand-600 hover:text-brand-700"
          >
            {showAdvanced ? '▲ Hide' : '▼ Advanced settings'}
          </button>

          {showAdvanced && (
            <div className="mt-3 space-y-3 rounded-lg border border-gray-100 bg-gray-50 p-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Test email <span className="text-gray-400">(for enhanced conversions)</span>
                </label>
                <input
                  type="email"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  placeholder="test@example.com"
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Test phone <span className="text-gray-400">(for Meta CAPI)</span>
                </label>
                <input
                  type="tel"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  placeholder="+1 555 000 0000"
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
                />
              </div>
            </div>
          )}
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Starting audit…' : 'Run Signal Audit'}
        </button>
      </form>
    </div>
  );
}
