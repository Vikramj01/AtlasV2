/**
 * CAPI SetupWizard — Step 5: Activate
 *
 * Shows a summary of the provider configuration and activates it on confirm.
 * After activation the provider begins receiving live events from the pipeline.
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useCAPIStore } from '@/store/capiStore';
import { capiApi } from '@/lib/api/capiApi';

interface ActivateProps {
  onComplete: () => void;
  onBack: () => void;
}

export function Activate({ onComplete, onBack }: ActivateProps) {
  const {
    wizardProviderId,
    wizardDraft,
    wizardSaving,
    wizardError,
    setWizardSaving,
    setWizardError,
    closeWizard,
  } = useCAPIStore();

  const [activated, setActivated] = useState(false);

  async function handleActivate() {
    if (!wizardProviderId) {
      setWizardError('No provider ID found — please complete earlier steps first.');
      return;
    }
    setWizardSaving(true);
    setWizardError(null);
    try {
      await capiApi.activateProvider(wizardProviderId);
      setActivated(true);
      setTimeout(() => {
        closeWizard();
        onComplete();
      }, 2000);
    } catch (err) {
      setWizardError(err instanceof Error ? err.message : 'Failed to activate provider');
    } finally {
      setWizardSaving(false);
    }
  }

  const { event_mapping, identifier_config, dedup_config } = wizardDraft;

  return (
    <div className="space-y-6">
      {/* Summary card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configuration summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Provider */}
          <div className="flex items-center gap-3">
            {/* Meta logo — letter badge */}
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
              M
            </span>
            <div>
              <p className="text-sm font-medium">Meta</p>
              <p className="text-xs text-muted-foreground">Conversions API</p>
            </div>
          </div>

          <Separator />

          {/* Event mappings */}
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Event mappings
            </p>
            {event_mapping.length === 0 ? (
              <p className="text-sm text-muted-foreground">No event mappings configured.</p>
            ) : (
              <ul className="space-y-1">
                {event_mapping.map((m) => (
                  <li key={m.atlas_event} className="flex items-center gap-2 text-sm">
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{m.atlas_event}</code>
                    <span className="text-muted-foreground">→</span>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{m.provider_event}</code>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Separator />

          {/* Identifiers */}
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Identifiers
            </p>
            <p className="text-sm">
              {identifier_config.enabled_identifiers.length === 0
                ? 'None selected'
                : identifier_config.enabled_identifiers.join(', ')}
            </p>
          </div>

          <Separator />

          {/* Deduplication */}
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Deduplication
            </p>
            <p className="text-sm">
              {dedup_config.enabled ? 'Enabled (48h window)' : 'Disabled'}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Error banner */}
      {wizardError && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {wizardError}
        </div>
      )}

      {/* Success banner */}
      {activated && (
        <div className="rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800 font-medium">
          Provider is now active! Events will be delivered to Meta.
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={onBack} disabled={wizardSaving || activated}>
          Back
        </Button>
        <Button
          onClick={handleActivate}
          disabled={wizardSaving || activated || !wizardProviderId}
        >
          {wizardSaving ? 'Activating…' : activated ? 'Activated' : 'Activate provider'}
        </Button>
      </div>
    </div>
  );
}
