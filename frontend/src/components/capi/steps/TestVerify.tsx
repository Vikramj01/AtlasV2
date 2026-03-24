/**
 * CAPI SetupWizard — Step 4: Test & Verify
 *
 * Builds a sample Atlas event, shows the formatted payload, and allows
 * the user to fire a test event to the configured provider via the backend.
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useCAPIStore } from '@/store/capiStore';
import { capiApi } from '@/lib/api/capiApi';
import { buildAtlasEvent } from '@/lib/capi/pipeline';
import { formatMetaPayload } from '@/lib/capi/adapters/meta';
import { formatGooglePayload } from '@/lib/capi/adapters/google';
import { hashUserData } from '@/lib/capi/hash-pii';
import type { AtlasEvent, HashedIdentifier, EventMapping, GoogleCredentials } from '@/types/capi';

interface TestVerifyProps {
  onNext: () => void;
  onBack: () => void;
}

type TestStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'success'; providerResponse: unknown; emqEstimate?: number }
  | { kind: 'error'; message: string };

export function TestVerify({ onNext, onBack }: TestVerifyProps) {
  const {
    wizardProviderId,
    wizardDraft,
    wizardSaving,
    wizardError,
    setWizardError,
    setWizardSaving,
  } = useCAPIStore();

  const isGoogle = wizardDraft.provider === 'google';

  const [previewPayload, setPreviewPayload] = useState<unknown>(null);
  const [testStatus, setTestStatus] = useState<TestStatus>({ kind: 'idle' });

  // Derive the first event name from the draft mapping, or fall back to 'Purchase'
  const firstMapping: EventMapping | undefined = wizardDraft.event_mapping[0];
  const eventName = firstMapping?.atlas_event ?? 'Purchase';

  async function buildPreview(): Promise<{ event: AtlasEvent; identifiers: HashedIdentifier[] }> {
    const event = buildAtlasEvent(eventName, {
      custom_data: { value: 99.99, currency: 'USD', order_id: 'test-order-001' },
    });

    const identifiers = await hashUserData(
      { email: 'test@example.com', phone: '+12025550100' },
      wizardDraft.identifier_config.enabled_identifiers,
    );

    return { event, identifiers };
  }

  // Auto-build payload preview on mount
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const { event, identifiers } = await buildPreview();
        const mapping: EventMapping = firstMapping ?? {
          atlas_event: eventName,
          provider_event: isGoogle ? 'PURCHASE' : 'Purchase',
        };
        const formatted = isGoogle
          ? formatGooglePayload(event, mapping, identifiers, wizardDraft.credentials as GoogleCredentials)
          : formatMetaPayload(event, mapping, identifiers);
        if (!cancelled) setPreviewPayload(formatted);
      } catch (err) {
        if (!cancelled) {
          setWizardError(err instanceof Error ? err.message : 'Failed to build preview');
        }
      }
    }
    void init();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventName, isGoogle]);

  async function handleSendTest() {
    if (!wizardProviderId) return;
    setTestStatus({ kind: 'loading' });
    setWizardSaving(true);
    setWizardError(null);
    try {
      const { event } = await buildPreview();
      const response = await capiApi.testProvider(wizardProviderId, [event]);
      const firstResult = response.results[0];
      if (firstResult?.status === 'success') {
        setTestStatus({
          kind: 'success',
          providerResponse: firstResult.provider_response,
          emqEstimate: firstResult.emq_estimate,
        });
      } else {
        setTestStatus({
          kind: 'error',
          message: `Test event failed for "${firstResult?.event_name ?? eventName}"`,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error during test';
      setTestStatus({ kind: 'error', message });
      setWizardError(message);
    } finally {
      setWizardSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Section A — Preview payload */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Preview payload</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Shows how a sample <strong>{eventName}</strong> event will be formatted before it
            reaches {isGoogle ? 'Google Ads' : 'Meta'}. Sample PII is hashed using the same
            SHA-256 pipeline used in production.
          </p>

          {previewPayload ? (
            <pre className="overflow-x-auto rounded-md bg-muted p-4 text-xs leading-relaxed">
              {JSON.stringify(previewPayload, null, 2)}
            </pre>
          ) : (
            <p className="text-xs text-muted-foreground">Building payload preview…</p>
          )}
        </CardContent>
      </Card>

      <Separator />

      {/* Section B — Send test event */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Send test event</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!wizardProviderId ? (
            <div className="rounded-md border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
              Save credentials first — go back to step 1 if the provider was not created.
            </div>
          ) : (
            <>
              {isGoogle ? (
                <p className="text-sm text-muted-foreground">
                  Validates payload structure via Google Ads API{' '}
                  <code className="rounded bg-muted px-1 py-0.5 text-xs">validateOnly=true</code>{' '}
                  mode. No data is recorded in Google Ads.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Sends a single test event to Meta using your configured pixel. Check Events Manager
                  to confirm receipt.
                </p>
              )}

              <Button
                onClick={handleSendTest}
                disabled={!wizardProviderId || wizardSaving || testStatus.kind === 'loading'}
              >
                {testStatus.kind === 'loading' || wizardSaving
                  ? 'Sending…'
                  : isGoogle
                  ? 'Send test event to Google Ads'
                  : 'Send test event to Meta'}
              </Button>

              {testStatus.kind === 'success' && (
                <div className="rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800 space-y-2">
                  <p className="font-medium">Test event delivered successfully.</p>
                  {testStatus.emqEstimate !== undefined && (
                    <p>{isGoogle ? 'Google' : 'Meta'} reports EMQ: {testStatus.emqEstimate}/10</p>
                  )}
                  <pre className="mt-1 overflow-x-auto rounded bg-green-100 p-2 text-xs">
                    {JSON.stringify(testStatus.providerResponse, null, 2)}
                  </pre>
                </div>
              )}

              {testStatus.kind === 'error' && (
                <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
                  <p className="font-medium">Test event failed.</p>
                  <p className="mt-1">{testStatus.message}</p>
                </div>
              )}

              {wizardError && testStatus.kind !== 'error' && (
                <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
                  {wizardError}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onNext}>
          Continue
        </Button>
      </div>
    </div>
  );
}
