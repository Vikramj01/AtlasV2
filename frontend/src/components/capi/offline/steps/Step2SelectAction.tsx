/**
 * Offline Conversions Setup Wizard — Step 2: Select Conversion Action
 *
 * Fetches available conversion actions from the user's Google Ads account
 * via the Atlas backend (which uses the stored OAuth credentials).
 * The user picks the action that represents a closed deal / offline sale.
 */

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { offlineConversionsApi } from '@/lib/api/offlineConversionsApi';
import { useOfflineConversionsStore } from '@/store/offlineConversionsStore';
import type { GoogleConversionAction } from '@/types/offline-conversions';

interface Props {
  onNext: () => void;
  onBack: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  PURCHASE: 'Purchase',
  SUBMIT_LEAD_FORM: 'Lead Form',
  SIGNUP: 'Sign Up',
  SUBSCRIBE: 'Subscribe',
  DEFAULT: 'Default',
  DOWNLOAD: 'Download',
  PAGE_VIEW: 'Page View',
  CONTACT: 'Contact',
  OTHER: 'Other',
};

export function Step2SelectAction({ onNext, onBack }: Props) {
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
    if (conversionActions.length > 0) return; // already loaded
    if (!wizardDraft.capi_provider_id) return;

    setConversionActionsLoading(true);
    setWizardError(null);

    offlineConversionsApi.listConversionActions(wizardDraft.capi_provider_id)
      .then(({ actions, customer_id }) => {
        setConversionActions(actions);
        // Persist customer_id so it's available for config save in step 5
        setWizardDraft({ google_customer_id: customer_id });
      })
      .catch((err) => setWizardError(err instanceof Error ? err.message : 'Failed to fetch conversion actions'))
      .finally(() => setConversionActionsLoading(false));
  }, [wizardDraft.capi_provider_id]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSelect(action: GoogleConversionAction) {
    setWizardDraft({
      conversion_action_id: action.id,
      conversion_action_name: action.name,
    });
  }

  function handleNext() {
    if (!wizardDraft.conversion_action_id) return;
    onNext();
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
          optimise your campaigns toward this outcome rather than form submissions.
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
        <Button onClick={handleNext} disabled={!wizardDraft.conversion_action_id}>
          Next
        </Button>
      </div>
    </div>
  );
}
