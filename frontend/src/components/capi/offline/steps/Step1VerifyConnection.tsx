/**
 * Offline Conversions Setup Wizard — Step 1: Select Ad Platform Connection
 *
 * Lists the user's existing Google and Meta CAPI providers.
 * Selecting one determines the provider_type for the whole wizard.
 * No new credentials are collected here — existing OAuth / access-token
 * credentials are reused for offline upload.
 */

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { capiApi } from '@/lib/api/capiApi';
import { useOfflineConversionsStore } from '@/store/offlineConversionsStore';
import type { CAPIProviderConfig } from '@/types/capi';
import type { OfflineProviderType } from '@/types/offline-conversions';

interface Props {
  onNext: () => void;
}

const PROVIDER_LABELS: Record<string, string> = {
  google: 'Google Ads',
  meta:   'Meta (Facebook)',
};

const PROVIDER_DESCRIPTIONS: Record<string, string> = {
  google: 'Upload closed deals via uploadClickConversions — optimise for revenue, not form fills.',
  meta:   'Upload offline conversions via Meta CAPI with action_source=offline.',
};

const STATUS_LABEL: Record<string, string> = {
  active:  'Active',
  testing: 'Testing',
  draft:   'Draft',
  paused:  'Paused',
  error:   'Error',
};

const STATUS_COLOR: Record<string, string> = {
  active:  'bg-green-100 text-green-700',
  testing: 'bg-yellow-100 text-yellow-700',
  draft:   'bg-gray-100 text-gray-600',
  paused:  'bg-orange-100 text-orange-700',
  error:   'bg-red-100 text-red-700',
};

export function Step1VerifyConnection({ onNext }: Props) {
  const { wizardDraft, setWizardDraft, setConversionActions } = useOfflineConversionsStore();

  const [providers, setProviders] = useState<CAPIProviderConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState(wizardDraft.capi_provider_id);

  useEffect(() => {
    capiApi.listProviders()
      .then((all) => setProviders(all.filter((p) => p.provider === 'google' || p.provider === 'meta')))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load providers'))
      .finally(() => setLoading(false));
  }, []);

  function handleSelect(p: CAPIProviderConfig) {
    // If switching provider types, clear stale conversion actions from the store
    const newProviderType = p.provider as OfflineProviderType;
    if (newProviderType !== wizardDraft.provider_type) {
      setConversionActions([]);
    }
    setSelectedId(p.id);
  }

  function handleNext() {
    if (!selectedId) return;
    const selected = providers.find((p) => p.id === selectedId);
    if (!selected) return;
    setWizardDraft({
      capi_provider_id: selectedId,
      provider_type: selected.provider as OfflineProviderType,
    });
    onNext();
  }

  const googleProviders = providers.filter((p) => p.provider === 'google');
  const metaProviders   = providers.filter((p) => p.provider === 'meta');

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
      <p className="text-sm text-muted-foreground">
        Select the ad platform you want to send offline conversions to. The CAPI credentials
        you connected in Realtime CAPI are reused — no re-authentication required.
      </p>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {providers.length === 0 && !error ? (
        <Card>
          <CardContent className="py-10 text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              No supported CAPI provider found. Set up a Google or Meta provider in the
              Realtime CAPI tab first.
            </p>
            <p className="text-xs text-muted-foreground">
              Offline conversions share the same credentials — you only need to connect once.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {([['google', googleProviders], ['meta', metaProviders]] as [string, CAPIProviderConfig[]][])
            .filter(([, group]) => group.length > 0)
            .map(([providerKey, group]) => (
              <div key={providerKey} className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {PROVIDER_LABELS[providerKey]}
                </p>
                <p className="text-xs text-muted-foreground -mt-1">
                  {PROVIDER_DESCRIPTIONS[providerKey]}
                </p>
                {group.map((p) => {
                  const isSelected = selectedId === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleSelect(p)}
                      className={[
                        'w-full rounded-lg border px-4 py-3 text-left transition-colors',
                        isSelected
                          ? 'border-primary bg-primary/5 ring-1 ring-primary'
                          : 'border-input hover:border-muted-foreground',
                      ].join(' ')}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">{PROVIDER_LABELS[p.provider] ?? p.provider}</p>
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
            ))}
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={handleNext} disabled={!selectedId || providers.length === 0}>
          Next
        </Button>
      </div>
    </div>
  );
}
