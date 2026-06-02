import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { FieldMappingRow } from './FieldMappingRow';
import { cn } from '@/lib/utils';
import type { ClientIdentityConfig, SaveIdentityConfigRequest, ValidateFieldPathResponse } from '@/types/enrichment';
import type { IdentifierType } from '@/types/capi';

interface IdentityConfigStepProps {
  clientId: string;
  initialConfig: ClientIdentityConfig | null;
  onSave: (config: SaveIdentityConfigRequest) => Promise<void>;
  onSkip?: () => void;
  mode: 'wizard' | 'standalone';
  onValidatePath?: (path: string) => Promise<ValidateFieldPathResponse>;
}

interface FieldState {
  value: string;
  enabled: boolean;
}

const DEFAULT_FIELDS = {
  email: { value: '', enabled: true },
  phone: { value: '', enabled: true },
  first_name: { value: '', enabled: false },
  last_name: { value: '', enabled: false },
  postal_code: { value: '', enabled: false },
  country: { value: '', enabled: false },
  external_id: { value: '', enabled: false },
  fbc: { value: '_fbc', enabled: true },
  fbp: { value: '_fbp', enabled: true },
  gclid: { value: 'gclid', enabled: true },
  wbraid: { value: 'wbraid', enabled: false },
  gbraid: { value: 'gbraid', enabled: false },
};

function computeIdentityScore(fields: typeof DEFAULT_FIELDS, autoCaptureIp: boolean, autoCaptureUa: boolean): number {
  let score = 0;
  if (fields.email.enabled && fields.email.value) score += 35;
  if (fields.phone.enabled && fields.phone.value) score += 20;
  if (fields.fbc.enabled && fields.fbc.value) score += 15;
  if (fields.fbp.enabled && fields.fbp.value) score += 10;
  if (fields.gclid.enabled && fields.gclid.value) score += 10;
  if (autoCaptureIp) score += 5;
  if (autoCaptureUa) score += 5;
  return score;
}

function estimateEmq(score: number): number {
  return score >= 80 ? 8 : score >= 60 ? 6 : score >= 40 ? 4 : 2;
}

function estimateMatchRate(score: number): number {
  return score >= 70 ? 65 : score >= 50 ? 45 : 20;
}

export function IdentityConfigStep({
  clientId,
  initialConfig,
  onSave,
  onSkip,
  mode,
  onValidatePath,
}: IdentityConfigStepProps) {
  const [fields, setFields] = useState<typeof DEFAULT_FIELDS>({ ...DEFAULT_FIELDS });
  const [autoCaptureIp, setAutoCaptureIp] = useState(true);
  const [autoCaptureUa, setAutoCaptureUa] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddressFields, setShowAddressFields] = useState(false);

  // Populate from initial config
  useEffect(() => {
    if (!initialConfig) return;
    setFields({
      email: { value: initialConfig.email_field ?? '', enabled: initialConfig.enabled_identifiers.includes('email') },
      phone: { value: initialConfig.phone_field ?? '', enabled: initialConfig.enabled_identifiers.includes('phone') },
      first_name: { value: initialConfig.first_name_field ?? '', enabled: initialConfig.enabled_identifiers.includes('fn') },
      last_name: { value: initialConfig.last_name_field ?? '', enabled: initialConfig.enabled_identifiers.includes('ln') },
      postal_code: { value: initialConfig.postal_code_field ?? '', enabled: initialConfig.enabled_identifiers.includes('zp') },
      country: { value: initialConfig.country_field ?? '', enabled: initialConfig.enabled_identifiers.includes('country') },
      external_id: { value: initialConfig.external_id_field ?? '', enabled: initialConfig.enabled_identifiers.includes('external_id') },
      fbc: { value: initialConfig.fbc_field ?? '_fbc', enabled: initialConfig.enabled_identifiers.includes('fbc') },
      fbp: { value: initialConfig.fbp_field ?? '_fbp', enabled: initialConfig.enabled_identifiers.includes('fbp') },
      gclid: { value: initialConfig.gclid_field ?? 'gclid', enabled: initialConfig.enabled_identifiers.includes('gclid') },
      wbraid: { value: initialConfig.wbraid_field ?? 'wbraid', enabled: initialConfig.enabled_identifiers.includes('wbraid') },
      gbraid: { value: initialConfig.gbraid_field ?? 'gbraid', enabled: initialConfig.enabled_identifiers.includes('gbraid') },
    });
    setAutoCaptureIp(initialConfig.auto_capture_ip);
    setAutoCaptureUa(initialConfig.auto_capture_ua);
    if (initialConfig.first_name_field || initialConfig.last_name_field || initialConfig.postal_code_field) {
      setShowAddressFields(true);
    }
  }, [initialConfig]);

  const setField = useCallback((key: keyof typeof DEFAULT_FIELDS, updates: Partial<FieldState>): void => {
    setFields((prev) => ({ ...prev, [key]: { ...prev[key], ...updates } }));
  }, []);

  const handleValidate = useCallback(
    async (path: string): Promise<ValidateFieldPathResponse> => {
      if (!onValidatePath) return { valid: true };
      return onValidatePath(path);
    },
    [onValidatePath],
  );

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const enabledIdentifiers: IdentifierType[] = [];
      if (fields.email.enabled) enabledIdentifiers.push('email');
      if (fields.phone.enabled) enabledIdentifiers.push('phone');
      if (fields.first_name.enabled) enabledIdentifiers.push('fn');
      if (fields.last_name.enabled) enabledIdentifiers.push('ln');
      if (fields.postal_code.enabled) enabledIdentifiers.push('zp');
      if (fields.country.enabled) enabledIdentifiers.push('country');
      if (fields.external_id.enabled) enabledIdentifiers.push('external_id');
      if (fields.fbc.enabled) enabledIdentifiers.push('fbc');
      if (fields.fbp.enabled) enabledIdentifiers.push('fbp');
      if (fields.gclid.enabled) enabledIdentifiers.push('gclid');
      if (fields.wbraid.enabled) enabledIdentifiers.push('wbraid');
      if (fields.gbraid.enabled) enabledIdentifiers.push('gbraid');
      if (autoCaptureIp) enabledIdentifiers.push('client_ip_address' as IdentifierType);
      if (autoCaptureUa) enabledIdentifiers.push('client_user_agent' as IdentifierType);

      await onSave({
        client_id: clientId,
        email_field: fields.email.value || null,
        phone_field: fields.phone.value || null,
        first_name_field: fields.first_name.value || null,
        last_name_field: fields.last_name.value || null,
        postal_code_field: fields.postal_code.value || null,
        country_field: fields.country.value || null,
        external_id_field: fields.external_id.value || null,
        fbc_field: fields.fbc.value || '_fbc',
        fbp_field: fields.fbp.value || '_fbp',
        gclid_field: fields.gclid.value || 'gclid',
        wbraid_field: fields.wbraid.value || 'wbraid',
        gbraid_field: fields.gbraid.value || 'gbraid',
        auto_capture_ip: autoCaptureIp,
        auto_capture_ua: autoCaptureUa,
        enabled_identifiers: enabledIdentifiers,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const identityScore = computeIdentityScore(fields, autoCaptureIp, autoCaptureUa);
  const emq = estimateEmq(identityScore);
  const matchRate = estimateMatchRate(identityScore);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Identity &amp; Match Quality Configuration</h2>
        <p className="text-sm text-gray-500 mt-1">
          Map your client's dataLayer field names to Atlas's identity schema. These settings control how Atlas
          matches conversions to real people in Google and Meta — the primary driver of value-optimised campaign
          performance.
        </p>
      </div>

      {/* Field mapping rows */}
      <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
        <div className="px-4 py-2 bg-gray-50 rounded-t-lg">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Identity Fields</p>
        </div>
        <div className="px-4">
          <FieldMappingRow
            label="Email"
            description="dataLayer path to customer email address"
            priority="must"
            value={fields.email.value}
            onChange={(v) => setField('email', { value: v })}
            enabled={fields.email.enabled}
            onToggleEnabled={(e) => setField('email', { enabled: e })}
            onValidate={handleValidate}
            suggestions={['customer.email', 'user.email', 'order.customer_email']}
            placeholder="customer.email"
          />
          <FieldMappingRow
            label="Phone"
            description="dataLayer path to customer phone number (E.164 format recommended)"
            priority="recommended"
            value={fields.phone.value}
            onChange={(v) => setField('phone', { value: v })}
            enabled={fields.phone.enabled}
            onToggleEnabled={(e) => setField('phone', { enabled: e })}
            onValidate={handleValidate}
            suggestions={['customer.phone', 'user.phone']}
            placeholder="customer.phone"
          />
        </div>

        <div className="px-4 py-2 bg-gray-50">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Click IDs</p>
        </div>
        <div className="px-4">
          <FieldMappingRow
            label="Facebook Click ID (fbc)"
            description="Cookie name or dataLayer path for Meta ad click ID"
            priority="recommended"
            value={fields.fbc.value}
            onChange={(v) => setField('fbc', { value: v })}
            enabled={fields.fbc.enabled}
            onToggleEnabled={(e) => setField('fbc', { enabled: e })}
            defaultValue="_fbc"
            placeholder="_fbc"
          />
          <FieldMappingRow
            label="Facebook Browser ID (fbp)"
            description="Cookie name for Meta browser cookie"
            priority="recommended"
            value={fields.fbp.value}
            onChange={(v) => setField('fbp', { value: v })}
            enabled={fields.fbp.enabled}
            onToggleEnabled={(e) => setField('fbp', { enabled: e })}
            defaultValue="_fbp"
            placeholder="_fbp"
          />
          <FieldMappingRow
            label="Google Click ID (gclid)"
            description="URL parameter or dataLayer path for Google Ads click ID"
            priority="recommended"
            value={fields.gclid.value}
            onChange={(v) => setField('gclid', { value: v })}
            enabled={fields.gclid.enabled}
            onToggleEnabled={(e) => setField('gclid', { enabled: e })}
            defaultValue="gclid"
            placeholder="gclid"
          />
        </div>

        {/* Address fields (collapsible) */}
        <div className="px-4 py-3">
          <button
            type="button"
            onClick={() => setShowAddressFields((v) => !v)}
            className="text-sm text-blue-600 hover:underline"
          >
            {showAddressFields ? '▾ Hide address fields' : '▸ Show address fields (best practice)'}
          </button>
        </div>

        {showAddressFields && (
          <div className="px-4">
            <FieldMappingRow
              label="First Name"
              priority="best"
              value={fields.first_name.value}
              onChange={(v) => setField('first_name', { value: v })}
              enabled={fields.first_name.enabled}
              onToggleEnabled={(e) => setField('first_name', { enabled: e })}
              suggestions={['customer.firstName', 'customer.first_name']}
              placeholder="customer.firstName"
            />
            <FieldMappingRow
              label="Last Name"
              priority="best"
              value={fields.last_name.value}
              onChange={(v) => setField('last_name', { value: v })}
              enabled={fields.last_name.enabled}
              onToggleEnabled={(e) => setField('last_name', { enabled: e })}
              suggestions={['customer.lastName', 'customer.last_name']}
              placeholder="customer.lastName"
            />
            <FieldMappingRow
              label="Postal Code"
              priority="best"
              value={fields.postal_code.value}
              onChange={(v) => setField('postal_code', { value: v })}
              enabled={fields.postal_code.enabled}
              onToggleEnabled={(e) => setField('postal_code', { enabled: e })}
              suggestions={['customer.zip', 'customer.postcode']}
              placeholder="customer.zip"
            />
            <FieldMappingRow
              label="Country"
              priority="best"
              value={fields.country.value}
              onChange={(v) => setField('country', { value: v })}
              enabled={fields.country.enabled}
              onToggleEnabled={(e) => setField('country', { enabled: e })}
              suggestions={['customer.country']}
              placeholder="customer.country"
            />
            <FieldMappingRow
              label="Customer / External ID"
              description="Your CRM or platform customer ID"
              priority="best"
              value={fields.external_id.value}
              onChange={(v) => setField('external_id', { value: v })}
              enabled={fields.external_id.enabled}
              onToggleEnabled={(e) => setField('external_id', { enabled: e })}
              suggestions={['customer.id', 'user.id']}
              placeholder="customer.id"
            />
          </div>
        )}

        {/* Auto-capture */}
        <div className="px-4 py-3 space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Auto-capture</p>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoCaptureIp}
              onChange={(e) => setAutoCaptureIp(e.target.checked)}
              className="rounded border-gray-300"
            />
            <span className="text-sm text-gray-700">Automatically capture client IP address from request</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoCaptureUa}
              onChange={(e) => setAutoCaptureUa(e.target.checked)}
              className="rounded border-gray-300"
            />
            <span className="text-sm text-gray-700">Automatically capture browser user agent from request</span>
          </label>
        </div>
      </div>

      {/* Live score preview */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
        <p className="text-sm font-semibold text-gray-700">Estimated Match Quality</p>
        <div className="space-y-2">
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-gray-600">
              <span>Meta EMQ estimate</span>
              <span className="font-semibold">{emq}/10</span>
            </div>
            <div className="flex gap-0.5">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className={cn('h-2 flex-1 rounded-sm', i < emq ? 'bg-blue-500' : 'bg-gray-200')} />
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-gray-600">
              <span>Google match rate</span>
              <span className="font-semibold">~{matchRate}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-1.5">
              <div className="bg-blue-500 h-1.5 rounded-full transition-all duration-300" style={{ width: `${matchRate}%` }} />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-1 pt-1">
          {fields.email.enabled && fields.email.value && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">email ✓</span>}
          {fields.phone.enabled && fields.phone.value && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">phone ✓</span>}
          {fields.fbc.enabled && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">fbc ✓</span>}
          {fields.fbp.enabled && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">fbp ✓</span>}
          {fields.gclid.enabled && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">gclid ✓</span>}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex justify-between pt-2">
        {mode === 'wizard' && onSkip ? (
          <Button type="button" variant="ghost" onClick={onSkip}>
            Skip for now
          </Button>
        ) : (
          <div />
        )}
        <Button type="button" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : mode === 'wizard' ? 'Save & Continue →' : 'Save changes'}
        </Button>
      </div>
    </div>
  );
}
