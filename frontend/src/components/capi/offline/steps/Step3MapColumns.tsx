/**
 * Offline Conversions Setup Wizard — Step 3: Map CSV Columns
 *
 * Users specify what their CRM export CSV headers are called so Atlas
 * can extract the right values from each row. Pre-populated with the
 * Atlas template headers — users who download the template can skip this step.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useOfflineConversionsStore } from '@/store/offlineConversionsStore';

interface Props {
  onNext: () => void;
  onBack: () => void;
}

// Atlas field → { label, description, required }
const ATLAS_FIELDS: Array<{
  key: string;
  label: string;
  description: string;
  required: boolean;
  defaultHeader: string;
}> = [
  {
    key: 'gclid',
    label: 'Google Click ID (GCLID)',
    description: 'The gclid URL parameter captured at form fill. Highest match rate (~90%).',
    required: false,
    defaultHeader: 'Click ID (GCLID)',
  },
  {
    key: 'email',
    label: 'Email Address',
    description: 'Lead / customer email. Required if no GCLID. Match rate ~30–50% without GCLID.',
    required: false,
    defaultHeader: 'Email Address',
  },
  {
    key: 'phone',
    label: 'Phone Number',
    description: 'Normalised to E.164 (+country code). Optional but improves match rate.',
    required: false,
    defaultHeader: 'Phone',
  },
  {
    key: 'conversion_time',
    label: 'Conversion Date / Time',
    description: 'When the deal closed. ISO 8601 or YYYY-MM-DD. Must be within 90 days.',
    required: true,
    defaultHeader: 'Conversion Date',
  },
  {
    key: 'conversion_value',
    label: 'Deal Value',
    description: 'Revenue amount. Leave blank to use the default value set in the next step.',
    required: false,
    defaultHeader: 'Deal Value',
  },
  {
    key: 'currency',
    label: 'Currency',
    description: 'ISO 4217 code (USD, GBP, EUR…). Falls back to your default currency.',
    required: false,
    defaultHeader: 'Currency',
  },
  {
    key: 'order_id',
    label: 'Order / Deal ID',
    description: 'Used for deduplication on Google\'s side. Highly recommended.',
    required: false,
    defaultHeader: 'Order ID',
  },
];

export function Step3MapColumns({ onNext, onBack }: Props) {
  const { wizardDraft, setWizardDraft } = useOfflineConversionsStore();

  // Initialise mapping from store, falling back to default headers
  const [mapping, setMapping] = useState<Record<string, string>>(() => {
    const stored = wizardDraft.column_mapping as Record<string, string | undefined>;
    return Object.fromEntries(
      ATLAS_FIELDS.map((f) => [f.key, stored[f.key] ?? f.defaultHeader]),
    );
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate(): boolean {
    const next: Record<string, string> = {};
    // conversion_time is the only required column mapping
    if (!mapping.conversion_time?.trim()) {
      next.conversion_time = 'Conversion date column header is required.';
    }
    // At least gclid or email must be mapped
    if (!mapping.gclid?.trim() && !mapping.email?.trim()) {
      next.gclid = 'Map at least one identifier: GCLID or email.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function handleNext() {
    if (!validate()) return;
    setWizardDraft({ column_mapping: mapping });
    onNext();
  }

  function handleChange(key: string, value: string) {
    setMapping((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => { const e = { ...prev }; delete e[key]; return e; });
  }

  function resetToDefaults() {
    setMapping(Object.fromEntries(ATLAS_FIELDS.map((f) => [f.key, f.defaultHeader])));
    setErrors({});
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-muted-foreground">
          Enter the exact column headers from your CRM export CSV. Leave blank to skip a field.
          If you download the Atlas template (Step 5), these are already filled in correctly.
        </p>
      </div>

      <div className="space-y-4">
        {ATLAS_FIELDS.map((field) => (
          <div key={field.key} className="space-y-1">
            <div className="flex items-center gap-1.5">
              <label htmlFor={`col-${field.key}`} className="block text-sm font-medium">
                {field.label}
              </label>
              {field.required && (
                <span className="text-xs text-destructive">*</span>
              )}
            </div>
            <input
              id={`col-${field.key}`}
              type="text"
              value={mapping[field.key] ?? ''}
              onChange={(e) => handleChange(field.key, e.target.value)}
              placeholder={field.defaultHeader}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="text-xs text-muted-foreground">{field.description}</p>
            {errors[field.key] && (
              <p className="text-xs text-destructive">{errors[field.key]}</p>
            )}
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={resetToDefaults}
        className="text-xs text-muted-foreground underline hover:text-foreground"
      >
        Reset to Atlas template defaults
      </button>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack}>Back</Button>
        <Button onClick={handleNext}>Next</Button>
      </div>
    </div>
  );
}
