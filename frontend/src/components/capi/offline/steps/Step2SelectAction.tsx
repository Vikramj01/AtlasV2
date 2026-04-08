/**
 * Offline Conversions Setup Wizard — Step 2: Select Conversion Action / Event
 *
 * Forks on provider_type:
 *   - Google → fetches conversion actions from Google Ads, user picks one
 *   - Meta   → user picks a standard Meta event name (or enters custom)
 */

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { offlineConversionsApi } from '@/lib/api/offlineConversionsApi';
import { useOfflineConversionsStore } from '@/store/offlineConversionsStore';
import type { GoogleConversionAction } from '@/types/offline-conversions';

interface Props {
  onNext: () => void;
  onBack: () => void;
}

// ── Google: conversion action picker ─────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  PURCHASE:        'Purchase',
  SUBMIT_LEAD_FORM:'Lead Form',
  SIGNUP:          'Sign Up',
  SUBSCRIBE:       'Subscribe',
  DEFAULT:         'Default',
  DOWNLOAD:        'Download',
  PAGE_VIEW:       'Page View',
  CONTACT:         'Contact',
  OTHER:           'Other',
};

function GoogleActionPicker({
  onNext,
  onBack,
}: {
  onNext: () => void;
  onBack: () => void;
}) {
  const {
    wizardDraft,
    setWizardDraft,
    conversionActions,
    conversionActionsLoading,
    setConversionActions,
    setConversionActionsLoading,
    wizardError,
    setWizardError,
  } = useOfflineConversionsStore();

  useEffect(() => {
    if (conversionActions.length > 0) return;
    if (!wizardDraft.capi_provider_id) return;

    setConversionActionsLoading(true);
    setWizardError(null);

    offlineConversionsApi.listConversionActions(wizardDraft.capi_provider_id)
      .then(({ actions, customer_id }) => {
        setConversionActions(actions);
        setWizardDraft({ google_customer_id: customer_id });
      })
      .catch((err) => setWizardError(err instanceof Error ? err.message : 'Failed to fetch conversion actions'))
      .finally(() => setConversionActionsLoading(false));
  }, [wizardDraft.capi_provider_id]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSelect(action: GoogleConversionAction) {
    setWizardDraft({ conversion_action_id: action.id, conversion_action_name: action.name });
  }

  if (conversionActionsLoading) {
    return (
      <div className="space-y-3">
        <div className="h-4 w-48 animate-pulse rounded bg-muted" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-lg border bg-muted" />
        ))}
        <div className="flex justify-between mt-4">
          <Button variant="ghost" disabled>Back</Button>
          <Button disabled>Next</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-muted-foreground">
          Select the conversion action that represents a closed deal or offline sale. Google will
          optimise campaigns toward this outcome rather than form submissions.
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Typical improvement: 20–40% lead quality lift when optimising for closed revenue.
        </p>
      </div>

      {wizardError && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {wizardError}
        </div>
      )}

      {conversionActions.length === 0 && !wizardError && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No conversion actions found in your Google Ads account. Create an "Upload clicks" conversion
          action in Google Ads → Tools → Conversions, then return here.
        </div>
      )}

      <div className="space-y-2 max-h-72 overflow-y-auto">
        {conversionActions.map((action) => {
          const isSelected = wizardDraft.conversion_action_id === action.id;
          return (
            <button
              key={action.id}
              type="button"
              onClick={() => handleSelect(action)}
              className={[
                'w-full rounded-lg border px-4 py-3 text-left transition-colors',
                isSelected
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-input hover:border-muted-foreground',
              ].join(' ')}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{action.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {CATEGORY_LABELS[action.category] ?? action.category}
                    {' · '}
                    {action.type.replace(/_/g, ' ').toLowerCase()}
                  </p>
                </div>
                {action.status !== 'ENABLED' && (
                  <span className="text-xs px-2 py-0.5 rounded bg-orange-100 text-orange-700 font-medium">
                    {action.status.toLowerCase()}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack}>Back</Button>
        <Button onClick={onNext} disabled={!wizardDraft.conversion_action_id}>
          Next
        </Button>
      </div>
    </div>
  );
}

// ── Meta: event name picker ───────────────────────────────────────────────────

const META_STANDARD_EVENTS = [
  { value: 'Purchase',             label: 'Purchase',              description: 'A sale or completed transaction' },
  { value: 'Lead',                 label: 'Lead',                  description: 'A lead collected (e.g. contact form, demo request)' },
  { value: 'CompleteRegistration', label: 'Complete Registration',  description: 'A completed sign-up or registration' },
  { value: 'Subscribe',            label: 'Subscribe',             description: 'A recurring subscription start' },
  { value: 'StartTrial',           label: 'Start Trial',           description: 'A free or paid trial started' },
  { value: 'Schedule',             label: 'Schedule',              description: 'A booked appointment or demo' },
  { value: 'Contact',              label: 'Contact',               description: 'A phone call, email, or chat initiated' },
  { value: 'CustomEvent',          label: 'Custom event…',         description: 'Enter a custom event name' },
];

function MetaEventPicker({
  onNext,
  onBack,
}: {
  onNext: () => void;
  onBack: () => void;
}) {
  const { wizardDraft, setWizardDraft } = useOfflineConversionsStore();

  const isCustom = (v: string) => !META_STANDARD_EVENTS.slice(0, -1).some((e) => e.value === v);
  const storedEvent = wizardDraft.meta_event_name || '';

  const [selectedValue, setSelectedValue] = useState<string>(
    storedEvent && !isCustom(storedEvent) ? storedEvent : storedEvent ? 'CustomEvent' : '',
  );
  const [customName, setCustomName] = useState(
    storedEvent && isCustom(storedEvent) ? storedEvent : '',
  );
  const [customError, setCustomError] = useState<string | null>(null);

  function handleSelect(value: string) {
    setSelectedValue(value);
    setCustomError(null);
    if (value !== 'CustomEvent') {
      setWizardDraft({ meta_event_name: value });
    }
  }

  function handleCustomChange(value: string) {
    setCustomName(value);
    setCustomError(null);
    setWizardDraft({ meta_event_name: value.trim() });
  }

  function handleNext() {
    if (selectedValue === 'CustomEvent') {
      if (!customName.trim()) {
        setCustomError('Please enter a custom event name.');
        return;
      }
      setWizardDraft({ meta_event_name: customName.trim() });
    }
    if (!wizardDraft.meta_event_name) return;
    onNext();
  }

  const canProceed = selectedValue !== '' && selectedValue !== 'CustomEvent'
    ? true
    : customName.trim().length > 0;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-muted-foreground">
          Select the Meta event type for these offline conversions. This must match the event
          your pixel fires online so Meta can deduplicate and attribute correctly.
        </p>
      </div>

      <div className="space-y-2 max-h-72 overflow-y-auto">
        {META_STANDARD_EVENTS.map((event) => {
          const isSelected = selectedValue === event.value;
          return (
            <button
              key={event.value}
              type="button"
              onClick={() => handleSelect(event.value)}
              className={[
                'w-full rounded-lg border px-4 py-3 text-left transition-colors',
                isSelected
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-input hover:border-muted-foreground',
              ].join(' ')}
            >
              <p className="text-sm font-medium">{event.label}</p>
              <p className="text-xs text-muted-foreground">{event.description}</p>
            </button>
          );
        })}
      </div>

      {selectedValue === 'CustomEvent' && (
        <div className="space-y-1">
          <label htmlFor="custom-event" className="block text-sm font-medium">
            Custom event name
          </label>
          <input
            id="custom-event"
            type="text"
            value={customName}
            onChange={(e) => handleCustomChange(e.target.value)}
            placeholder="e.g. ClosedWon"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {customError && <p className="text-xs text-destructive">{customError}</p>}
          <p className="text-xs text-muted-foreground">
            Use PascalCase to match Meta's event naming convention.
          </p>
        </div>
      )}

      <div className="rounded-md bg-muted px-4 py-3 text-sm text-muted-foreground">
        Meta uses <strong>event_id</strong> (set to your order ID) to deduplicate offline events
        against pixel-fired online events. Ensure you send the same order ID in both.
      </div>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack}>Back</Button>
        <Button onClick={handleNext} disabled={!canProceed}>
          Next
        </Button>
      </div>
    </div>
  );
}

// ── Export: fork on provider_type ─────────────────────────────────────────────

export function Step2SelectAction({ onNext, onBack }: Props) {
  const { wizardDraft } = useOfflineConversionsStore();

  if (wizardDraft.provider_type === 'meta') {
    return <MetaEventPicker onNext={onNext} onBack={onBack} />;
  }

  return <GoogleActionPicker onNext={onNext} onBack={onBack} />;
}
