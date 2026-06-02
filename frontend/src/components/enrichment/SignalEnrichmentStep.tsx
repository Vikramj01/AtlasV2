import { useState, useCallback } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { FieldMappingRow } from './FieldMappingRow';
import { cn } from '@/lib/utils';
import type {
  SignalEnrichmentConfig,
  SaveSignalEnrichmentRequest,
  ValueConfig,
  CurrencyConfig,
  SignalDedupConfig,
  ContentConfig,
  ValidateFieldPathResponse,
} from '@/types/enrichment';

interface ConversionSignal {
  signal_key: string;
  signal_name: string;
  platform_mappings: Record<string, unknown>;
  current_config: SignalEnrichmentConfig | null;
}

interface SignalEnrichmentStepProps {
  deploymentId: string;
  conversionSignals: ConversionSignal[];
  onSave: (configs: SaveSignalEnrichmentRequest[]) => Promise<void>;
  onBack?: () => void;
  onSkip?: () => void;
  onValidatePath?: (path: string) => Promise<ValidateFieldPathResponse>;
}

interface SignalFormState {
  value_field: string;
  includes_tax: boolean;
  includes_shipping: boolean;
  currency_mode: 'static' | 'dynamic';
  currency_field: string;
  currency_static: string;
  dedup_field: string;
  content_ids_field: string;
  content_ids_path_type: 'array' | 'string' | 'nested';
  num_items_field: string;
  enabled_for_meta: boolean;
  enabled_for_google: boolean;
}

const DEFAULT_FORM: SignalFormState = {
  value_field: '',
  includes_tax: false,
  includes_shipping: false,
  currency_mode: 'static',
  currency_field: '',
  currency_static: 'GBP',
  dedup_field: '',
  content_ids_field: '',
  content_ids_path_type: 'array',
  num_items_field: '',
  enabled_for_meta: true,
  enabled_for_google: true,
};

function configToForm(config: SignalEnrichmentConfig | null): SignalFormState {
  if (!config) return { ...DEFAULT_FORM };
  return {
    value_field: config.value_config?.field ?? '',
    includes_tax: config.value_config?.includes_tax ?? false,
    includes_shipping: config.value_config?.includes_shipping ?? false,
    currency_mode: config.currency_config?.mode ?? 'static',
    currency_field: config.currency_config?.mode === 'dynamic' ? (config.currency_config.field ?? '') : '',
    currency_static: config.currency_config?.mode === 'static' ? (config.currency_config.static_value ?? 'GBP') : 'GBP',
    dedup_field: config.dedup_config?.field ?? '',
    content_ids_field: config.content_config?.ids_field ?? '',
    content_ids_path_type: config.content_config?.ids_path_type ?? 'array',
    num_items_field: config.content_config?.num_items_field ?? '',
    enabled_for_meta: config.enabled_for_meta,
    enabled_for_google: config.enabled_for_google,
  };
}

function formToRequest(deploymentId: string, signalKey: string, form: SignalFormState): SaveSignalEnrichmentRequest {
  const value_config: ValueConfig | null = form.value_field
    ? { field: form.value_field, includes_tax: form.includes_tax, includes_shipping: form.includes_shipping }
    : null;

  const currency_config: CurrencyConfig | null = form.currency_mode === 'static' && form.currency_static
    ? { mode: 'static', static_value: form.currency_static }
    : form.currency_mode === 'dynamic' && form.currency_field
    ? { mode: 'dynamic', field: form.currency_field }
    : null;

  const dedup_config: SignalDedupConfig | null = form.dedup_field ? { field: form.dedup_field } : null;

  const content_config: ContentConfig | null = form.content_ids_field
    ? {
        ids_field: form.content_ids_field,
        ids_path_type: form.content_ids_path_type,
        num_items_field: form.num_items_field || undefined,
      }
    : null;

  return {
    deployment_id: deploymentId,
    signal_key: signalKey,
    value_config,
    currency_config,
    dedup_config,
    content_config,
    enabled_for_meta: form.enabled_for_meta,
    enabled_for_google: form.enabled_for_google,
  };
}

function computeSignalScore(form: SignalFormState): number {
  let score = 100;
  if (!form.value_field) score -= 25;
  if (!form.dedup_field) score -= 25;
  if (!(form.currency_mode === 'static' ? form.currency_static : form.currency_field)) score -= 25;
  if (!form.content_ids_field) score -= 10;
  return Math.max(0, score);
}

function ScorePill({ score }: { score: number }) {
  return (
    <span
      className={cn(
        'text-xs font-semibold px-2 py-0.5 rounded-full',
        score >= 70 ? 'bg-green-100 text-green-700' : score >= 40 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700',
      )}
    >
      {score}/100
    </span>
  );
}

const VALUE_SUGGESTIONS = [
  'ecommerce.purchase.actionField.revenue',
  'ecommerce.value',
  'checkout.totalPrice',
];
const ORDER_ID_SUGGESTIONS = [
  'ecommerce.purchase.actionField.id',
  'ecommerce.transaction_id',
  'checkout.orderId',
];
const CURRENCY_SUGGESTIONS = ['ecommerce.currencyCode', 'ecommerce.currency'];
const CONTENT_IDS_SUGGESTIONS = ['ecommerce.purchase.products', 'ecommerce.items'];

export function SignalEnrichmentStep({
  deploymentId,
  conversionSignals,
  onSave,
  onBack,
  onSkip,
  onValidatePath,
}: SignalEnrichmentStepProps) {
  const [forms, setForms] = useState<Record<string, SignalFormState>>(() =>
    Object.fromEntries(conversionSignals.map((s) => [s.signal_key, configToForm(s.current_config)])),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateForm = useCallback((signalKey: string, updates: Partial<SignalFormState>) => {
    setForms((prev) => ({ ...prev, [signalKey]: { ...prev[signalKey], ...updates } }));
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
      const requests = conversionSignals.map((s) =>
        formToRequest(deploymentId, s.signal_key, forms[s.signal_key] ?? DEFAULT_FORM),
      );
      await onSave(requests);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (conversionSignals.length === 0) {
    return (
      <div className="text-center py-10 text-gray-500 text-sm">
        No conversion signals in this deployment require enrichment configuration.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Signal Enrichment</h2>
        <p className="text-sm text-gray-500 mt-1">
          Map the dataLayer fields that carry value, currency, dedup ID, and product data for each conversion
          signal. Atlas handles server-side hashing — pass raw values from the browser.
        </p>
      </div>

      <Tabs defaultValue={conversionSignals[0].signal_key}>
        <TabsList className="w-full justify-start overflow-x-auto">
          {conversionSignals.map((signal) => {
            const form = forms[signal.signal_key] ?? DEFAULT_FORM;
            const score = computeSignalScore(form);
            return (
              <TabsTrigger key={signal.signal_key} value={signal.signal_key} className="gap-2">
                <span className="capitalize">{signal.signal_name.replace(/_/g, ' ')}</span>
                <ScorePill score={score} />
              </TabsTrigger>
            );
          })}
        </TabsList>

        {conversionSignals.map((signal) => {
          const form = forms[signal.signal_key] ?? DEFAULT_FORM;
          return (
            <TabsContent key={signal.signal_key} value={signal.signal_key} className="space-y-4 pt-4">

              {/* Value */}
              <div className="rounded-lg border border-gray-200 bg-white">
                <div className="px-4 py-2 bg-gray-50 rounded-t-lg">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Value Configuration</p>
                </div>
                <div className="px-4">
                  <FieldMappingRow
                    label="Order value field path"
                    priority="must"
                    value={form.value_field}
                    onChange={(v) => updateForm(signal.signal_key, { value_field: v })}
                    enabled={true}
                    showToggle={false}
                    onValidate={handleValidate}
                    suggestions={VALUE_SUGGESTIONS}
                    placeholder="ecommerce.purchase.actionField.revenue"
                  />
                  <div className="py-3 space-y-2 border-b border-gray-100">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.includes_tax}
                        onChange={(e) => updateForm(signal.signal_key, { includes_tax: e.target.checked })}
                        className="rounded border-gray-300"
                      />
                      <span className="text-sm text-gray-700">Value includes tax</span>
                      {form.includes_tax && <span className="text-xs text-amber-600">May inflate ROAS</span>}
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.includes_shipping}
                        onChange={(e) => updateForm(signal.signal_key, { includes_shipping: e.target.checked })}
                        className="rounded border-gray-300"
                      />
                      <span className="text-sm text-gray-700">Value includes shipping</span>
                      {form.includes_shipping && <span className="text-xs text-amber-600">May inflate ROAS</span>}
                    </label>
                  </div>

                  {/* Currency */}
                  <div className="py-3 space-y-2 border-b border-gray-100 last:border-0">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-900">Currency</span>
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-red-100 text-red-700 border-red-200">REQUIRED</span>
                    </div>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          checked={form.currency_mode === 'static'}
                          onChange={() => updateForm(signal.signal_key, { currency_mode: 'static' })}
                        />
                        <span className="text-sm text-gray-700">Static</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          checked={form.currency_mode === 'dynamic'}
                          onChange={() => updateForm(signal.signal_key, { currency_mode: 'dynamic' })}
                        />
                        <span className="text-sm text-gray-700">Dynamic from dataLayer</span>
                      </label>
                    </div>
                    {form.currency_mode === 'static' ? (
                      <input
                        type="text"
                        value={form.currency_static}
                        onChange={(e) => updateForm(signal.signal_key, { currency_static: e.target.value.toUpperCase() })}
                        placeholder="GBP"
                        maxLength={3}
                        className="font-mono text-sm border border-gray-300 rounded-md px-3 py-1.5 w-24 uppercase"
                      />
                    ) : (
                      <FieldMappingRow
                        label="Currency field path"
                        priority="must"
                        value={form.currency_field}
                        onChange={(v) => updateForm(signal.signal_key, { currency_field: v })}
                        enabled={true}
                        showToggle={false}
                        onValidate={handleValidate}
                        suggestions={CURRENCY_SUGGESTIONS}
                        placeholder="ecommerce.currencyCode"
                      />
                    )}
                  </div>
                </div>
              </div>

              {/* Deduplication */}
              <div className="rounded-lg border border-gray-200 bg-white">
                <div className="px-4 py-2 bg-gray-50 rounded-t-lg">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Deduplication</p>
                </div>
                <div className="px-4">
                  <FieldMappingRow
                    label="Unique order / event ID field"
                    description="Must be the same value in both browser and server events to prevent double-counting."
                    priority="must"
                    value={form.dedup_field}
                    onChange={(v) => updateForm(signal.signal_key, { dedup_field: v })}
                    enabled={true}
                    showToggle={false}
                    onValidate={handleValidate}
                    suggestions={ORDER_ID_SUGGESTIONS}
                    placeholder="ecommerce.purchase.actionField.id"
                  />
                </div>
              </div>

              {/* Product data */}
              <div className="rounded-lg border border-gray-200 bg-white">
                <div className="px-4 py-2 bg-gray-50 rounded-t-lg">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Product Data</p>
                </div>
                <div className="px-4">
                  <FieldMappingRow
                    label="Product IDs field"
                    description="dataLayer path to the array of product identifiers"
                    priority="recommended"
                    value={form.content_ids_field}
                    onChange={(v) => updateForm(signal.signal_key, { content_ids_field: v })}
                    enabled={true}
                    showToggle={false}
                    onValidate={handleValidate}
                    suggestions={CONTENT_IDS_SUGGESTIONS}
                    placeholder="ecommerce.purchase.products"
                  />
                  {form.content_ids_field && (
                    <div className="py-3 flex gap-4">
                      {(['array', 'string', 'nested'] as const).map((type) => (
                        <label key={type} className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="radio"
                            checked={form.content_ids_path_type === type}
                            onChange={() => updateForm(signal.signal_key, { content_ids_path_type: type })}
                          />
                          <span className="text-sm text-gray-700 capitalize">{type}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Platform enablement */}
              <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Platform Enablement</p>
                <div className="flex items-center gap-3">
                  <Switch
                    checked={form.enabled_for_meta}
                    onCheckedChange={(v) => updateForm(signal.signal_key, { enabled_for_meta: v })}
                  />
                  <Label className="text-sm">Send enriched signal to Meta CAPI</Label>
                </div>
                <div className="flex items-center gap-3">
                  <Switch
                    checked={form.enabled_for_google}
                    onCheckedChange={(v) => updateForm(signal.signal_key, { enabled_for_google: v })}
                  />
                  <Label className="text-sm">Send enriched signal to Google Enhanced Conversions</Label>
                </div>
              </div>
            </TabsContent>
          );
        })}
      </Tabs>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex justify-between pt-2">
        <div className="flex gap-2">
          {onBack && (
            <Button type="button" variant="outline" onClick={onBack}>
              ← Back
            </Button>
          )}
          {onSkip && (
            <Button type="button" variant="ghost" onClick={onSkip}>
              Skip enrichment
            </Button>
          )}
        </div>
        <Button type="button" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save & Generate →'}
        </Button>
      </div>
    </div>
  );
}
