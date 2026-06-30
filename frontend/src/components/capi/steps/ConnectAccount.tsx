/**
 * SetupWizard — Step 1: Connect your account
 * File: frontend/src/components/capi/steps/ConnectAccount.tsx
 */

import { useState } from 'react';
import type * as React from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useCAPIStore } from '@/store/capiStore';
import type { CAPIAdapterName, MetaCredentials, GoogleCredentials, LinkedInCredentials, AmazonCredentials } from '@/types/capi';

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

// ── LinkedIn form ─────────────────────────────────────────────────────────────

function LinkedInConnectForm({ onNext }: ConnectAccountProps) {
  const { wizardDraft, setWizardDraft } = useCAPIStore();

  const draft = wizardDraft.credentials as Partial<LinkedInCredentials>;

  const [accountId, setAccountId]       = useState(draft.account_id    ?? '');
  const [accessToken, setAccessToken]   = useState(draft.access_token  ?? '');
  const [conversionId, setConversionId] = useState(draft.conversion_id ?? '');
  const [showToken, setShowToken]       = useState(false);
  const [errors, setErrors] = useState<{
    account_id?: string;
    access_token?: string;
    conversion_id?: string;
  }>({});

  function validate(): boolean {
    const next: typeof errors = {};
    if (!accountId.trim())    next.account_id    = 'Ad Account ID is required.';
    if (!accessToken.trim())  next.access_token  = 'Access Token is required.';
    if (!conversionId.trim()) next.conversion_id = 'Conversion ID is required.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setWizardDraft({
      credentials: {
        account_id:    accountId.trim().replace(/^urn:.*:/, ''), // strip URN prefix if pasted
        access_token:  accessToken.trim(),
        conversion_id: conversionId.trim().replace(/^urn:.*:/, ''),
      } satisfies LinkedInCredentials,
    });
    onNext();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      <div className="space-y-1">
        <label htmlFor="li_account_id" className="block text-sm font-medium">
          Ad Account ID
        </label>
        <input
          id="li_account_id"
          type="text"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          placeholder="123456789"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <p className="text-xs text-muted-foreground">
          Found in LinkedIn Campaign Manager &rarr; Account Assets &rarr; your account number.
        </p>
        {errors.account_id && (
          <p className="text-xs text-destructive">{errors.account_id}</p>
        )}
      </div>

      <div className="space-y-1">
        <label htmlFor="li_access_token" className="block text-sm font-medium">
          Access Token
        </label>
        <div className="relative">
          <input
            id="li_access_token"
            type={showToken ? 'text' : 'password'}
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            placeholder="Enter your LinkedIn OAuth access token"
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
        <p className="text-xs text-muted-foreground">
          OAuth 2.0 token with <code className="font-mono">rw_conversions</code> scope. Generated from
          LinkedIn Developer Portal &rarr; your app &rarr; Auth.
        </p>
        {errors.access_token && (
          <p className="text-xs text-destructive">{errors.access_token}</p>
        )}
      </div>

      <div className="space-y-1">
        <label htmlFor="li_conversion_id" className="block text-sm font-medium">
          Conversion ID
        </label>
        <input
          id="li_conversion_id"
          type="text"
          value={conversionId}
          onChange={(e) => setConversionId(e.target.value)}
          placeholder="987654321"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <p className="text-xs text-muted-foreground">
          Numeric ID from Campaign Manager &rarr; Analyze &rarr; Conversion Tracking &rarr; your
          conversion rule. Atlas wraps it in the URN format automatically.
        </p>
        {errors.conversion_id && (
          <p className="text-xs text-destructive">{errors.conversion_id}</p>
        )}
      </div>

      <div className="rounded-md bg-muted px-4 py-3 text-sm text-muted-foreground">
        Your LinkedIn app must have the <code className="font-mono">rw_conversions</code> Marketing
        API permission approved. Tokens expire after 60 days — you will be prompted to reconnect when
        Atlas detects an expired token.
      </div>

      <div className="flex justify-end">
        <Button type="submit">Next</Button>
      </div>
    </form>
  );
}

// ── Amazon form ───────────────────────────────────────────────────────────────

function AmazonConnectForm({ onNext }: ConnectAccountProps) {
  const { wizardDraft, setWizardDraft } = useCAPIStore();

  const draft = wizardDraft.credentials as Partial<AmazonCredentials>;

  const [profileId, setProfileId]       = useState(draft.profile_id    ?? '');
  const [clientId, setClientId]         = useState(draft.client_id     ?? '');
  const [clientSecret, setClientSecret] = useState(draft.client_secret ?? '');
  const [accessToken, setAccessToken]   = useState(draft.access_token  ?? '');
  const [refreshToken, setRefreshToken] = useState(draft.refresh_token ?? '');
  const [entityId, setEntityId]         = useState(draft.entity_id     ?? '');
  const [region, setRegion]             = useState<'NA' | 'EU' | 'FE'>(draft.region ?? 'NA');
  const [showSecret, setShowSecret]     = useState(false);
  const [showAccess, setShowAccess]     = useState(false);
  const [showRefresh, setShowRefresh]   = useState(false);
  const [errors, setErrors] = useState<{
    profile_id?: string;
    client_id?: string;
    client_secret?: string;
    access_token?: string;
    refresh_token?: string;
  }>({});

  function validate(): boolean {
    const next: typeof errors = {};
    if (!profileId.trim())    next.profile_id    = 'Profile ID is required.';
    if (!clientId.trim())     next.client_id     = 'Client ID is required.';
    if (!clientSecret.trim()) next.client_secret = 'Client Secret is required.';
    if (!accessToken.trim())  next.access_token  = 'Access Token is required.';
    if (!refreshToken.trim()) next.refresh_token = 'Refresh Token is required.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setWizardDraft({
      credentials: {
        profile_id:    profileId.trim(),
        client_id:     clientId.trim(),
        client_secret: clientSecret.trim(),
        access_token:  accessToken.trim(),
        refresh_token: refreshToken.trim(),
        region,
        ...(entityId.trim() ? { entity_id: entityId.trim() } : {}),
      } satisfies AmazonCredentials,
    });
    onNext();
  }

  const inputClass = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring';

  function PasswordField({ id, label, value, onChange, show, setShow, error, hint }: {
    id: string; label: string; value: string; onChange: (v: string) => void;
    show: boolean; setShow: (v: boolean) => void; error?: string; hint?: string;
  }) {
    return (
      <div className="space-y-1">
        <label htmlFor={id} className="block text-sm font-medium">{label}</label>
        <div className="relative">
          <input id={id} type={show ? 'text' : 'password'} value={value}
            onChange={(e) => onChange(e.target.value)} placeholder={`Enter ${label.toLowerCase()}`}
            className={`${inputClass} pr-20`}
          />
          <button type="button" onClick={() => setShow(!show)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground focus:outline-none">
            {show ? 'Hide' : 'Show'}
          </button>
        </div>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      <div className="space-y-1">
        <label htmlFor="amz_profile_id" className="block text-sm font-medium">Profile ID</label>
        <input id="amz_profile_id" type="text" value={profileId}
          onChange={(e) => setProfileId(e.target.value)} placeholder="1234567890"
          className={inputClass}
        />
        <p className="text-xs text-muted-foreground">
          Found in the Amazon Ads Console &rarr; Settings &rarr; your Profile ID.
          Used as the <code className="font-mono">Amazon-Advertising-Api-Scope</code> header.
        </p>
        {errors.profile_id && <p className="text-xs text-destructive">{errors.profile_id}</p>}
      </div>

      <div className="space-y-1">
        <label htmlFor="amz_region" className="block text-sm font-medium">API Region</label>
        <select id="amz_region" value={region}
          onChange={(e) => setRegion(e.target.value as 'NA' | 'EU' | 'FE')}
          className={inputClass}>
          <option value="NA">North America (NA)</option>
          <option value="EU">Europe (EU)</option>
          <option value="FE">Far East (FE)</option>
        </select>
        <p className="text-xs text-muted-foreground">Select the region matching your Amazon Ads account.</p>
      </div>

      <div className="space-y-1">
        <label htmlFor="amz_client_id" className="block text-sm font-medium">Client ID</label>
        <input id="amz_client_id" type="text" value={clientId}
          onChange={(e) => setClientId(e.target.value)} placeholder="amzn1.application-oa2-client.xxx"
          className={inputClass}
        />
        <p className="text-xs text-muted-foreground">
          From your Amazon Developer Console &rarr; Security Profile &rarr; Web Settings.
        </p>
        {errors.client_id && <p className="text-xs text-destructive">{errors.client_id}</p>}
      </div>

      <PasswordField id="amz_client_secret" label="Client Secret" value={clientSecret}
        onChange={setClientSecret} show={showSecret} setShow={setShowSecret}
        error={errors.client_secret}
        hint="From your Amazon Developer Console Security Profile." />

      <PasswordField id="amz_access_token" label="Access Token" value={accessToken}
        onChange={setAccessToken} show={showAccess} setShow={setShowAccess}
        error={errors.access_token}
        hint="Current OAuth 2.0 access token. Atlas refreshes this automatically using your refresh token." />

      <PasswordField id="amz_refresh_token" label="Refresh Token" value={refreshToken}
        onChange={setRefreshToken} show={showRefresh} setShow={setShowRefresh}
        error={errors.refresh_token}
        hint="Long-lived token used to obtain new access tokens without re-authentication." />

      <div className="space-y-1">
        <label htmlFor="amz_entity_id" className="block text-sm font-medium">
          DSP Entity ID <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <input id="amz_entity_id" type="text" value={entityId}
          onChange={(e) => setEntityId(e.target.value)} placeholder="ENTITY1ABC2DEF3GHI"
          className={inputClass}
        />
        <p className="text-xs text-muted-foreground">
          Only required when sending conversions via Amazon DSP (not Sponsored Ads).
        </p>
      </div>

      <div className="rounded-md bg-muted px-4 py-3 text-sm text-muted-foreground">
        Generate OAuth tokens from the Amazon Developer Console using Login with Amazon (LWA).
        Ensure your app has the <code className="font-mono">advertising::campaign_management</code> scope.
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
  const provider = wizardDraft.provider;
  const isGoogle   = provider === 'google';
  const isLinkedIn = provider === 'linkedin';
  const isAmazon   = provider === 'amazon';

  const adapterLabel = GOOGLE_ADAPTER_OPTIONS.find((o) => o.name === wizardDraft.adapter_name)?.label;

  const title = isGoogle
    ? 'Connect your Google Ads account'
    : isLinkedIn
      ? 'Connect your LinkedIn account'
      : isAmazon
        ? 'Connect your Amazon Ads account'
        : 'Connect your Meta account';

  const subtitle = isGoogle
    ? adapterLabel
      ? `Step 1 of 5 — ${adapterLabel}. Provide your Google Ads OAuth credentials.`
      : 'Step 1 of 5 — Choose your conversion type and provide your Google Ads credentials.'
    : isLinkedIn
      ? 'Step 1 of 5 — Provide your LinkedIn OAuth token and Conversion ID to get started.'
      : isAmazon
        ? 'Step 1 of 5 — Provide your Amazon Ads OAuth credentials to get started.'
        : 'Step 1 of 5 — Provide your Meta Pixel credentials to get started.';

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
      </CardHeader>
      <CardContent>
        {isGoogle   ? <GoogleConnectForm   onNext={onNext} /> :
         isLinkedIn ? <LinkedInConnectForm onNext={onNext} /> :
         isAmazon   ? <AmazonConnectForm   onNext={onNext} /> :
                      <MetaConnectForm     onNext={onNext} />}
      </CardContent>
    </Card>
  );
}
