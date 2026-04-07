/**
 * Offline Conversions Setup Wizard — Step 4: Set Defaults
 *
 * Users set a default currency and optional default conversion value.
 * These are applied to any CSV rows that omit those fields.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useOfflineConversionsStore } from '@/store/offlineConversionsStore';

interface Props {
  onNext: () => void;
  onBack: () => void;
}

const COMMON_CURRENCIES = [
  { code: 'USD', name: 'US Dollar' },
  { code: 'GBP', name: 'British Pound' },
  { code: 'EUR', name: 'Euro' },
  { code: 'CAD', name: 'Canadian Dollar' },
  { code: 'AUD', name: 'Australian Dollar' },
  { code: 'SGD', name: 'Singapore Dollar' },
  { code: 'AED', name: 'UAE Dirham' },
  { code: 'INR', name: 'Indian Rupee' },
  { code: 'JPY', name: 'Japanese Yen' },
  { code: 'CHF', name: 'Swiss Franc' },
  { code: 'NZD', name: 'New Zealand Dollar' },
  { code: 'SEK', name: 'Swedish Krona' },
  { code: 'NOK', name: 'Norwegian Krone' },
  { code: 'DKK', name: 'Danish Krone' },
  { code: 'ZAR', name: 'South African Rand' },
  { code: 'BRL', name: 'Brazilian Real' },
  { code: 'MXN', name: 'Mexican Peso' },
  { code: 'HKD', name: 'Hong Kong Dollar' },
];

export function Step4SetDefaults({ onNext, onBack }: Props) {
  const { wizardDraft, setWizardDraft } = useOfflineConversionsStore();

  const [currency, setCurrency] = useState(wizardDraft.default_currency || 'USD');
  const [defaultValue, setDefaultValue] = useState<string>(
    wizardDraft.default_conversion_value != null
      ? String(wizardDraft.default_conversion_value)
      : '',
  );
  const [errors, setErrors] = useState<{ currency?: string; value?: string }>({});

  function validate(): boolean {
    const next: { currency?: string; value?: string } = {};
    if (!currency.trim()) next.currency = 'Currency is required.';
    if (defaultValue.trim()) {
      const n = parseFloat(defaultValue);
      if (isNaN(n) || n <= 0) next.value = 'Default value must be a positive number.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function handleNext() {
    if (!validate()) return;
    setWizardDraft({
      default_currency: currency,
      default_conversion_value: defaultValue.trim() ? parseFloat(defaultValue) : null,
    });
    onNext();
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-muted-foreground">
          Set defaults for CSV rows that don't include these fields. Individual rows always
          override these defaults.
        </p>
      </div>

      {/* Default currency */}
      <div className="space-y-1">
        <label htmlFor="default_currency" className="block text-sm font-medium">
          Default Currency <span className="text-destructive text-xs">*</span>
        </label>
        <select
          id="default_currency"
          value={currency}
          onChange={(e) => { setCurrency(e.target.value); setErrors((prev) => ({ ...prev, currency: undefined })); }}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {COMMON_CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} — {c.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          Applied to rows where the currency column is blank or missing.
        </p>
        {errors.currency && <p className="text-xs text-destructive">{errors.currency}</p>}
      </div>

      {/* Default conversion value */}
      <div className="space-y-1">
        <label htmlFor="default_value" className="block text-sm font-medium">
          Default Conversion Value{' '}
          <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <input
          id="default_value"
          type="number"
          min="0.01"
          step="0.01"
          value={defaultValue}
          onChange={(e) => { setDefaultValue(e.target.value); setErrors((prev) => ({ ...prev, value: undefined })); }}
          placeholder="e.g. 5000"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <p className="text-xs text-muted-foreground">
          Applied when the deal value column is blank. Leave empty if every row will have a value.
        </p>
        {errors.value && <p className="text-xs text-destructive">{errors.value}</p>}
      </div>

      <div className="rounded-md bg-muted px-4 py-3 text-sm text-muted-foreground">
        Google uses conversion value to calculate ROAS and inform Smart Bidding. Even a rough
        average deal value improves optimisation significantly compared to no value.
      </div>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack}>Back</Button>
        <Button onClick={handleNext}>Next</Button>
      </div>
    </div>
  );
}
