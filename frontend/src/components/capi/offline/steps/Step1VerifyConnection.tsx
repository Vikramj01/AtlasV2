/**
 * Offline Conversions Setup Wizard — Step 1: Verify Google Ads Connection
 *
 * Lists the user's existing Google CAPI providers (active or testing).
 * The user selects one — its OAuth credentials will be reused for all
 * offline conversion uploads. No new credentials are collected here.
 */

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { capiApi } from '@/lib/api/capiApi';
import { useOfflineConversionsStore } from '@/store/offlineConversionsStore';
import type { CAPIProviderConfig } from '@/types/capi';

interface Props {
  onNext: () => void;
}

export function Step1VerifyConnection({ onNext }: Props) {
  const { wizardDraft, setWizardDraft } = useOfflineConversionsStore();

  const [providers, setProviders] = useState<CAPIProviderConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState(wizardDraft.capi_provider_id);

  useEffect(() => {
    capiApi.listProviders()
      .then((all) => setProviders(all.filter((p) => p.provider === 'google')))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load providers'))
      .finally(() => setLoading(false));
  }, []);

  function handleNext() {
    if (!selectedId) return;
    setWizardDraft({ capi_provider_id: selectedId });
    onNext();
  }

  const STATUS_LABEL: Record<string, string> = {
    active: 'Active',
    testing: 'Testing',
    draft: 'Draft',
    paused: 'Paused',
    error: 'Error',
  };

  const STATUS_COLOR: Record<string, string> = {
    active: 'bg-green-100 text-green-700',
    testing: 'bg-yellow-100 text-yellow-700',
    draft: 'bg-gray-100 text-gray-600',
    paused: 'bg-orange-100 text-orange-700',
    error: 'bg-red-100 text-red-700',
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-lg border bg-muted" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-muted-foreground">
          Offline conversions reuse your existing Google Ads OAuth credentials — no re-authentication
          required. Select the Google Ads account you want to upload conversions to.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {providers.length === 0 && !error ? (
        <Card>
          <CardContent className="py-10 text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              No Google Ads CAPI provider found. Set one up in the Realtime CAPI tab first.
            </p>
            <p className="text-xs text-muted-foreground">
              Offline conversions share the same OAuth credentials — you only need to connect once.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {providers.map((p) => {
            const isSelected = selectedId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedId(p.id)}
                className={[
                  'w-full rounded-lg border px-4 py-3 text-left transition-colors',
                  isSelected
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'border-input hover:border-muted-foreground',
                ].join(' ')}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Google Ads</p>
                    <p className="text-xs text-muted-foreground">
                      {p.events_sent_total.toLocaleString()} events sent
                    </p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_COLOR[p.status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {STATUS_LABEL[p.status] ?? p.status}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div className="rounded-md bg-muted px-4 py-3 text-sm text-muted-foreground">
        Offline conversions use <strong>uploadClickConversions</strong> — a separate Google Ads API
        endpoint from real-time Enhanced Conversions. Both use the same OAuth credentials.
      </div>

      <div className="flex justify-end">
        <Button onClick={handleNext} disabled={!selectedId || providers.length === 0}>
          Next
        </Button>
      </div>
    </div>
  );
}
