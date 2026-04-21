/**
 * SetupWizard — Step 1: Connect your account
 * File: frontend/src/components/capi/steps/ConnectAccount.tsx
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useCAPIStore } from '@/store/capiStore';
import type { CAPIAdapterName, MetaCredentials, GoogleCredentials } from '@/types/capi';

// ── Google adapter decision tree ──────────────────────────────────────────────

interface GoogleAdapterOption {
  name: CAPIAdapterName;
  label: string;
  description: string;
  whenToUse: string[];
}

const GOOGLE_ADAPTER_OPTIONS: GoogleAdapterOption[] = [
  {
    name: 'google_ec_web',
    label: 'Enhanced Conversions — Web',
    description: 'Real-time conversions from website events. Best for purchases, sign-ups, and form completions that happen on your site.',
    whenToUse: [
      'Conversion fires on the thank-you or confirmation page',
      'You have first-party data (email/phone) available at conversion time',
      'You want event-driven, sub-second delivery',
    ],
  },
  {
    name: 'google_ec_leads',
    label: 'Enhanced Conversions — Leads',
    description: 'Match CRM leads to ad clicks after form submission. Best for lead gen where the conversion happens offline (sales call, demo, in-person).',
    whenToUse: [
      'Conversion is a qualified lead, not an on-site purchase',
      'You match leads from your CRM to ad clicks using email + GCLID',
      'Conversion happens hours or days after the form fill',
    ],
  },
  {
    name: 'google_offline',
    label: 'Offline Conversions',
    description: 'Upload CSV files of offline conversions tied to ad clicks. Best for in-store sales, phone orders, or any conversion that happens outside your website.',
    whenToUse: [
      'Conversions occur offline (store, phone, in-person)',
      'You batch-upload conversion data from your CRM or POS',
      'You have GCLID captured at the time of the ad click',
    ],
  },
];

interface ConnectAccountProps {
  onNext: () => void;
}

// ── Meta form ─────────────────────────────────────────────────────────────────

function MetaConnectForm({ onNext }: ConnectAccountProps) {
  const { wizardDraft, setWizardDraft } = useCAPIStore();

  const draft = wizardDraft.credentials as Partial<MetaCredentials>;

  const [pixelId, setPixelId] = useState(draft.pixel_id ?? '');
  const [accessToken, setAccessToken] = useState(draft.access_token ?? '');
  const [datasetId, setDatasetId] = useState(draft.dataset_id ?? '');
  const [testEventCode, setTestEventCode] = useState(wizardDraft.test_event_code ?? '');
  const [showToken, setShowToken] = useState(false);
  const [limitedDataUse, setLimitedDataUse] = useState((draft.data_processing_options ?? []).includes('LDU'));
  const [errors, setErrors] = useState<{ pixel_id?: string; access_token?: string }>({});

  function validate(): boolean {
    const next: { pixel_id?: string; access_token?: string } = {};
    if (!pixelId.trim()) next.pixel_id = 'Pixel ID is required.';
    if (!accessToken.trim()) next.access_token = 'System User Access Token is required.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setWizardDraft({
      credentials: {
        pixel_id: pixelId.trim(),
        access_token: accessToken.trim(),
        dataset_id: datasetId.trim(),
        ...(limitedDataUse ? {
          data_processing_options: ['LDU'],
          data_processing_options_country: 0,
          data_processing_options_state: 0,
        } : {}),
      } satisfies MetaCredentials,
      test_event_code: testEventCode.trim(),
    });
    onNext();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      <div className="space-y-1">
        <label htmlFor="pixel_id" className="block text-sm font-medium">
          Pixel ID
        </label>
        <input
          id="pixel_id"
          type="text"
          value={pixelId}
          onChange={(e) => setPixelId(e.target.value)}
          placeholder="123456789012345"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {errors.pixel_id && (
          <p className="text-xs text-destructive">{errors.pixel_id}</p>
        )}
      </div>

      <div className="space-y-1">
        <label htmlFor="access_token" className="block text-sm font-medium">
          System User Access Token
        </label>
        <div className="relative">
          <input
            id="access_token"
            type={showToken ? 'text' : 'password'}
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            placeholder="Enter your system user access token"
            className="w-full rounded-md border border-input bg-background px-3 py-2 pr-20 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            type="button"
            onClick={() => setShowToken((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground focus:outline-none"
          >
            {showToken ? 'Hide' : 'Show'}
          </button>
        </div>
        {errors.access_token && (
          <p className="text-xs text-destructive">{errors.access_token}</p>
        )}
      </div>

      <div className="space-y-1">
        <label htmlFor="dataset_id" className="block text-sm font-medium">
          Dataset ID{' '}
          <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <input
          id="dataset_id"
          type="text"
          value={datasetId}
          onChange={(e) => setDatasetId(e.target.value)}
          placeholder="Same as Pixel ID if not using a dataset"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="test_event_code" className="block text-sm font-medium">
          Test Event Code{' '}
          <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <input
          id="test_event_code"
          type="text"
          value={testEventCode}
          onChange={(e) => setTestEventCode(e.target.value)}
          placeholder="TEST12345"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <p className="text-xs text-muted-foreground">
          Found in Meta Events Manager &rarr; Test Events tab. When set, events go to your test view only.
        </p>
      </div>

      <div className="rounded-md border border-border p-4 space-y-3">
        <p className="text-sm font-medium">Privacy settings</p>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={limitedDataUse}
            onChange={(e) => setLimitedDataUse(e.target.checked)}
            className="mt-0.5 rounded border-input"
          />
          <span className="text-sm">
            <span className="font-medium">Enable Limited Data Use (LDU)</span>
            <span className="block text-xs text-muted-foreground mt-0.5">
              Required for CCPA compliance when serving US users. Tells Meta to restrict how it uses event data for targeting.
              Geolocation is applied automatically.
            </span>
          </span>
        </label>
      </div>

      <div className="rounded-md bg-muted px-4 py-3 text-sm text-muted-foreground">
        Create a System User in your Meta Business Manager with standard access to your
        pixel. Never use a personal account token.
      </div>

      <div className="flex justify-end">
        <Button type="submit">Next</Button>
      </div>
    </form>
  );
}

// ── Google form ───────────────────────────────────────────────────────────────

function GoogleConnectForm({ onNext }: ConnectAccountProps) {
  const { wizardDraft, setWizardDraft } = useCAPIStore();

  const draft = wizardDraft.credentials as Partial<GoogleCredentials>;

  const [adapterName, setAdapterName] = useState<CAPIAdapterName>(wizardDraft.adapter_name ?? 'google_ec_web');
  const [adapterChosen, setAdapterChosen] = useState(!!wizardDraft.adapter_name);
  const [customerId, setCustomerId] = useState(draft.customer_id ?? '');
  const [oauthAccessToken, setOauthAccessToken] = useState(draft.oauth_access_token ?? '');
  const [oauthRefreshToken, setOauthRefreshToken] = useState(draft.oauth_refresh_token ?? '');
  const [conversionActionId, setConversionActionId] = useState(draft.conversion_action_id ?? '');
  const [loginCustomerId, setLoginCustomerId] = useState(draft.login_customer_id ?? '');
  const [showAccessToken, setShowAccessToken] = useState(false);
  const [showRefreshToken, setShowRefreshToken] = useState(false);
  const [errors, setErrors] = useState<{
    customer_id?: string;
    oauth_access_token?: string;
    oauth_refresh_token?: string;
    conversion_action_id?: string;
  }>();

  // ── Step A: adapter type selector ────────────────────────────────────────

  if (!adapterChosen) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Which type of Google conversion are you setting up? Choose the option that matches how your conversions happen.
        </p>
        <div className="space-y-3">
          {GOOGLE_ADAPTER_OPTIONS.map((opt) => (
            <label
              key={opt.name}
              className={`flex items-start gap-3 rounded-md border p-4 cursor-pointer transition-colors ${
                adapterName === opt.name ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
              }`}
            >
              <input
                type="radio"
                name="adapter_name"
                value={opt.name}
                checked={adapterName === opt.name}
                onChange={() => setAdapterName(opt.name)}
                className="mt-1"
              />
              <div className="space-y-1">
                <p className="text-sm font-medium">{opt.label}</p>
                <p className="text-xs text-muted-foreground">{opt.description}</p>
                <ul className="mt-2 space-y-0.5">
                  {opt.whenToUse.map((w) => (
                    <li key={w} className="text-xs text-muted-foreground flex items-start gap-1">
                      <span className="mt-0.5 shrink-0">✓</span>
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </label>
          ))}
        </div>
        <div className="flex justify-end">
          <Button
            type="button"
            onClick={() => {
              setWizardDraft({ adapter_name: adapterName });
              setAdapterChosen(true);
            }}
          >
            Continue
          </Button>
        </div>
      </div>
    );
  }

  function validate(): boolean {
    const next: { customer_id?: string; oauth_access_token?: string; oauth_refresh_token?: string; conversion_action_id?: string } = {};
    if (!customerId.trim()) next.customer_id = 'Customer ID is required.';
    if (!oauthAccessToken.trim()) next.oauth_access_token = 'OAuth Access Token is required.';
    if (!oauthRefreshToken.trim()) next.oauth_refresh_token = 'OAuth Refresh Token is required.';
    if (!conversionActionId.trim()) next.conversion_action_id = 'Conversion Action ID is required.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    const stripped = customerId.trim().replace(/-/g, '');
    setWizardDraft({
      adapter_name: adapterName,
      credentials: {
        customer_id: stripped,
        oauth_access_token: oauthAccessToken.trim(),
        oauth_refresh_token: oauthRefreshToken.trim(),
        conversion_action_id: conversionActionId.trim(),
        ...(loginCustomerId.trim() ? { login_customer_id: loginCustomerId.trim() } : {}),
      } satisfies GoogleCredentials,
    });
    onNext();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      <div className="space-y-1">
        <label htmlFor="customer_id" className="block text-sm font-medium">
          Customer ID
        </label>
        <input
          id="customer_id"
          type="text"
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
          placeholder="123-456-7890"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <p className="text-xs text-muted-foreground">
          Format: 123-456-7890. Dashes are stripped automatically before sending.
        </p>
        {errors?.customer_id && (
          <p className="text-xs text-destructive">{errors.customer_id}</p>
        )}
      </div>

      <div className="space-y-1">
        <label htmlFor="oauth_access_token" className="block text-sm font-medium">
          OAuth Access Token
        </label>
        <div className="relative">
          <input
            id="oauth_access_token"
            type={showAccessToken ? 'text' : 'password'}
            value={oauthAccessToken}
            onChange={(e) => setOauthAccessToken(e.target.value)}
            placeholder="Enter your OAuth access token"
            className="w-full rounded-md border border-input bg-background px-3 py-2 pr-20 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            type="button"
            onClick={() => setShowAccessToken((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground focus:outline-none"
          >
            {showAccessToken ? 'Hide' : 'Show'}
          </button>
        </div>
        {errors?.oauth_access_token && (
          <p className="text-xs text-destructive">{errors.oauth_access_token}</p>
        )}
      </div>

      <div className="space-y-1">
        <label htmlFor="oauth_refresh_token" className="block text-sm font-medium">
          OAuth Refresh Token
        </label>
        <div className="relative">
          <input
            id="oauth_refresh_token"
            type={showRefreshToken ? 'text' : 'password'}
            value={oauthRefreshToken}
            onChange={(e) => setOauthRefreshToken(e.target.value)}
            placeholder="Enter your OAuth refresh token"
            className="w-full rounded-md border border-input bg-background px-3 py-2 pr-20 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            type="button"
            onClick={() => setShowRefreshToken((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground focus:outline-none"
          >
            {showRefreshToken ? 'Hide' : 'Show'}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Stored securely and used to automatically renew your access token without re-authentication.
        </p>
        {errors?.oauth_refresh_token && (
          <p className="text-xs text-destructive">{errors.oauth_refresh_token}</p>
        )}
      </div>

      <div className="space-y-1">
        <label htmlFor="conversion_action_id" className="block text-sm font-medium">
          Conversion Action ID
        </label>
        <input
          id="conversion_action_id"
          type="text"
          value={conversionActionId}
          onChange={(e) => setConversionActionId(e.target.value)}
          placeholder="123456789"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <p className="text-xs text-muted-foreground">
          Numeric ID from Google Ads &rarr; Tools &rarr; Conversions.
        </p>
        {errors?.conversion_action_id && (
          <p className="text-xs text-destructive">{errors.conversion_action_id}</p>
        )}
      </div>

      <div className="space-y-1">
        <label htmlFor="login_customer_id" className="block text-sm font-medium">
          Manager Account ID{' '}
          <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <input
          id="login_customer_id"
          type="text"
          value={loginCustomerId}
          onChange={(e) => setLoginCustomerId(e.target.value)}
          placeholder="987-654-3210"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <p className="text-xs text-muted-foreground">
          MCC login-customer-id. Required only if accessing the account via a manager account.
        </p>
      </div>

      <div className="rounded-md bg-muted px-4 py-3 text-sm text-muted-foreground">
        💡 OAuth tokens are obtained from Google Cloud Console. The refresh token enables Atlas
        to automatically renew access tokens without re-authentication.
      </div>

      <div className="flex justify-end">
        <Button type="submit">Next</Button>
      </div>
    </form>
  );
}

// ── Container ─────────────────────────────────────────────────────────────────

export function ConnectAccount({ onNext }: ConnectAccountProps) {
  const { wizardDraft } = useCAPIStore();
  const isGoogle = wizardDraft.provider === 'google';

  const adapterLabel = GOOGLE_ADAPTER_OPTIONS.find((o) => o.name === wizardDraft.adapter_name)?.label;
  const title = isGoogle ? 'Connect your Google Ads account' : 'Connect your Meta account';
  const subtitle = isGoogle
    ? adapterLabel
      ? `Step 1 of 5 — ${adapterLabel}. Provide your Google Ads OAuth credentials.`
      : 'Step 1 of 5 — Choose your conversion type and provide your Google Ads credentials.'
    : 'Step 1 of 5 — Provide your Meta Pixel credentials to get started.';

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
      </CardHeader>
      <CardContent>
        {isGoogle ? (
          <GoogleConnectForm onNext={onNext} />
        ) : (
          <MetaConnectForm onNext={onNext} />
        )}
      </CardContent>
    </Card>
  );
}
