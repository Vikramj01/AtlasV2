/**
 * SetupWizard — Step 3: Configure identifiers
 * File: frontend/src/components/capi/steps/ConfigureIdentifiers.tsx
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useCAPIStore } from '@/store/capiStore';
import { estimateEMQ } from '@/lib/capi/adapters/meta';
import type { IdentifierType, HashedIdentifier } from '@/types/capi';

interface ConfigureIdentifiersProps {
  onNext: () => void;
  onBack: () => void;
}

// ── Identifier metadata ────────────────────────────────────────────────────────

interface IdentifierMeta {
  type: IdentifierType;
  label: string;
  isPII: boolean;
  disabledForMeta?: boolean;
  disabledReason?: string;
}

const IDENTIFIER_META: IdentifierMeta[] = [
  { type: 'email',       label: 'Email',                      isPII: true  },
  { type: 'phone',       label: 'Phone',                      isPII: true  },
  { type: 'fn',          label: 'First name',                 isPII: true  },
  { type: 'ln',          label: 'Last name',                  isPII: true  },
  { type: 'ct',          label: 'City',                       isPII: true  },
  { type: 'st',          label: 'State',                      isPII: true  },
  { type: 'zp',          label: 'Zip / Postal code',          isPII: true  },
  { type: 'country',     label: 'Country',                    isPII: true  },
  { type: 'external_id', label: 'External ID',                isPII: true  },
  { type: 'fbc',         label: 'Meta click cookie (fbc)',    isPII: false },
  { type: 'fbp',         label: 'Meta browser cookie (fbp)',  isPII: false },
  {
    type: 'gclid',
    label: 'Google Click ID (gclid)',
    isPII: false,
    disabledForMeta: true,
    disabledReason: 'Google identifiers — not used by Meta',
  },
  {
    type: 'wbraid',
    label: 'Google iOS web-to-app (wbraid)',
    isPII: false,
    disabledForMeta: true,
    disabledReason: 'Google identifiers — not used by Meta',
  },
  {
    type: 'gbraid',
    label: 'Google iOS app-to-web (gbraid)',
    isPII: false,
    disabledForMeta: true,
    disabledReason: 'Google identifiers — not used by Meta',
  },
];

// Build a HashedIdentifier stub for EMQ estimation purposes
function buildSampleIdentifiers(enabled: IdentifierType[]): HashedIdentifier[] {
  return enabled.map((type) => {
    const meta = IDENTIFIER_META.find((m) => m.type === type);
    return {
      type,
      value: 'sample',
      is_hashed: meta?.isPII ?? false,
    };
  });
}

function emqBadgeClass(score: number): string {
  if (score >= 7) return 'bg-green-100 text-green-800';
  if (score >= 4) return 'bg-yellow-100 text-yellow-800';
  return 'bg-red-100 text-red-800';
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ConfigureIdentifiers({ onNext, onBack }: ConfigureIdentifiersProps) {
  const { wizardDraft, setWizardDraft } = useCAPIStore();

  const [checked, setChecked] = useState<Set<IdentifierType>>(
    () => new Set(wizardDraft.identifier_config.enabled_identifiers),
  );

  function toggle(type: IdentifierType) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }

  const enabledList = Array.from(checked);
  const sampleIds = buildSampleIdentifiers(enabledList);
  const emqScore = estimateEMQ(sampleIds);

  function handleNext() {
    setWizardDraft({
      identifier_config: {
        enabled_identifiers: enabledList,
        source_mapping: {},
      },
    });
    onNext();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Configure identifiers</CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          Step 3 of 5 — Choose which user identifiers to send with each event. More identifiers
          improve Event Match Quality (EMQ).
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Identifier list */}
        <ul className="space-y-2">
          {IDENTIFIER_META.map((meta) => {
            const isDisabled = meta.disabledForMeta === true;
            const isChecked = checked.has(meta.type);

            return (
              <li
                key={meta.type}
                className={`flex items-center justify-between rounded-md border px-3 py-2 ${
                  isDisabled ? 'opacity-50 bg-muted cursor-not-allowed' : 'bg-background'
                }`}
              >
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id={`id-${meta.type}`}
                    checked={isDisabled ? false : isChecked}
                    disabled={isDisabled}
                    onChange={() => !isDisabled && toggle(meta.type)}
                    className="h-4 w-4 rounded border-input accent-primary cursor-pointer disabled:cursor-not-allowed"
                  />
                  <label
                    htmlFor={`id-${meta.type}`}
                    className={`text-sm select-none ${
                      isDisabled ? 'cursor-not-allowed' : 'cursor-pointer'
                    }`}
                  >
                    {meta.label}
                  </label>
                  {isDisabled && meta.disabledReason && (
                    <span
                      title={meta.disabledReason}
                      className="ml-1 text-xs text-muted-foreground italic hidden sm:inline"
                    >
                      {meta.disabledReason}
                    </span>
                  )}
                </div>

                <span
                  className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    isDisabled
                      ? 'bg-muted text-muted-foreground'
                      : meta.isPII
                      ? 'bg-blue-100 text-blue-800'
                      : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {isDisabled ? 'N/A' : meta.isPII ? 'Hashed' : 'Raw'}
                </span>
              </li>
            );
          })}
        </ul>

        {/* EMQ preview */}
        <div className="rounded-md border border-border bg-muted/40 px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Estimated EMQ: {emqScore}/10</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Based on selected identifiers. Higher is better (7–10 is ideal).
            </p>
          </div>
          <span
            className={`text-sm font-bold px-3 py-1 rounded-full ${emqBadgeClass(emqScore)}`}
          >
            {emqScore}/10
          </span>
        </div>

        <div className="flex justify-between">
          <Button type="button" variant="outline" onClick={onBack}>
            Back
          </Button>
          <Button type="button" onClick={handleNext}>
            Next
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
