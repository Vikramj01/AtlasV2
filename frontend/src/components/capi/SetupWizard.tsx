/**
 * CAPI SetupWizard — 5-step container
 *
 * Renders as a full-page card (not a modal).
 * Handles provider creation on step 1 → 2 and provider updates on steps 2 → 3
 * and 3 → 4. Step components are responsible for their own field state via the
 * shared wizardDraft in capiStore.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useCAPIStore } from '@/store/capiStore';
import { capiApi } from '@/lib/api/capiApi';
import { supabase } from '@/lib/supabase';
import type { ProviderCredentials } from '@/types/capi';
import { ConnectAccount } from './steps/ConnectAccount';
import { MapEvents } from './steps/MapEvents';
import { ConfigureIdentifiers } from './steps/ConfigureIdentifiers';
import { TestVerify } from './steps/TestVerify';
import { Activate } from './steps/Activate';

// ── Step indicator ─────────────────────────────────────────────────────────────

const STEPS: Array<{ number: 1 | 2 | 3 | 4 | 5; label: string }> = [
  { number: 1, label: 'Connect' },
  { number: 2, label: 'Map Events' },
  { number: 3, label: 'Identifiers' },
  { number: 4, label: 'Test' },
  { number: 5, label: 'Activate' },
];

interface StepIndicatorProps {
  current: 1 | 2 | 3 | 4 | 5;
}

function StepIndicator({ current }: StepIndicatorProps) {
  return (
    <div className="flex items-center justify-center gap-0">
      {STEPS.map((step, index) => {
        const done = step.number < current;
        const active = step.number === current;
        return (
          <div key={step.number} className="flex items-center">
            {/* Circle */}
            <div className="flex flex-col items-center">
              <div
                className={[
                  'flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-colors',
                  done
                    ? 'bg-primary text-primary-foreground'
                    : active
                    ? 'border-2 border-primary bg-background text-primary'
                    : 'border-2 border-muted bg-background text-muted-foreground',
                ].join(' ')}
              >
                {done ? '✓' : step.number}
              </div>
              <span
                className={[
                  'mt-1 text-xs',
                  active ? 'font-semibold text-primary' : 'text-muted-foreground',
                ].join(' ')}
              >
                {step.label}
              </span>
            </div>

            {/* Connector line between steps */}
            {index < STEPS.length - 1 && (
              <div
                className={[
                  'mb-5 h-0.5 w-10',
                  step.number < current ? 'bg-primary' : 'bg-muted',
                ].join(' ')}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Wizard container ───────────────────────────────────────────────────────────

interface SetupWizardProps {
  onComplete: () => void;
  onCancel: () => void;
}

export function SetupWizard({ onComplete, onCancel }: SetupWizardProps) {
  const {
    wizardStep,
    setWizardStep,
    wizardDraft,
    wizardProviderId,
    setWizardProviderId,
    wizardSaving,
    setWizardSaving,
    wizardError,
    setWizardError,
  } = useCAPIStore();

  // ── Step 1 → 2: create provider ──────────────────────────────────────────────

  async function handleStep1Next() {
    setWizardSaving(true);
    setWizardError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) throw new Error('Not authenticated');

      const result = await capiApi.createProvider({
        project_id: session.user.id,
        provider: wizardDraft.provider,
        credentials: wizardDraft.credentials as ProviderCredentials,
        event_mapping: wizardDraft.event_mapping,
        identifier_config: wizardDraft.identifier_config,
        dedup_config: wizardDraft.dedup_config,
      });

      setWizardProviderId(result.id);
      setWizardStep(2);
    } catch (err) {
      setWizardError(err instanceof Error ? err.message : 'Failed to create provider');
    } finally {
      setWizardSaving(false);
    }
  }

  // ── Step 2 → 3: update event mappings ────────────────────────────────────────

  async function handleStep2Next() {
    setWizardError(null);
    if (!wizardProviderId) {
      setWizardStep(3);
      return;
    }
    setWizardSaving(true);
    try {
      await capiApi.updateProvider(wizardProviderId, {
        event_mapping: wizardDraft.event_mapping,
      });
      setWizardStep(3);
    } catch (err) {
      setWizardError(err instanceof Error ? err.message : 'Failed to save event mappings');
    } finally {
      setWizardSaving(false);
    }
  }

  // ── Step 3 → 4: update identifier + dedup config ─────────────────────────────

  async function handleStep3Next() {
    setWizardError(null);
    if (!wizardProviderId) {
      setWizardStep(4);
      return;
    }
    setWizardSaving(true);
    try {
      await capiApi.updateProvider(wizardProviderId, {
        identifier_config: wizardDraft.identifier_config,
        dedup_config: wizardDraft.dedup_config,
      });
      setWizardStep(4);
    } catch (err) {
      setWizardError(err instanceof Error ? err.message : 'Failed to save identifier config');
    } finally {
      setWizardSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      {/* Header row: title + cancel */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Connect a Conversions API provider</h1>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={wizardSaving}>
          Cancel
        </Button>
      </div>

      {/* Step indicator */}
      <div className="mb-8">
        <StepIndicator current={wizardStep} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {STEPS.find((s) => s.number === wizardStep)?.label}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          {/* Global error banner — shown above step content */}
          {wizardError && (
            <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
              {wizardError}
            </div>
          )}

          {wizardStep === 1 && (
            <ConnectAccount onNext={handleStep1Next} />
          )}

          {wizardStep === 2 && (
            <MapEvents
              onNext={handleStep2Next}
              onBack={() => setWizardStep(1)}
            />
          )}

          {wizardStep === 3 && (
            <ConfigureIdentifiers
              onNext={handleStep3Next}
              onBack={() => setWizardStep(2)}
            />
          )}

          {wizardStep === 4 && (
            <TestVerify
              onNext={() => setWizardStep(5)}
              onBack={() => setWizardStep(3)}
            />
          )}

          {wizardStep === 5 && (
            <Activate
              onComplete={onComplete}
              onBack={() => setWizardStep(4)}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
