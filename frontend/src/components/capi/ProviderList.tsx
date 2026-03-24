/**
 * ProviderList — shows configured CAPI providers for the current user.
 * Used by CAPIPage (/integrations/capi).
 */

import { useEffect, useState } from 'react';
import { capiApi } from '@/lib/api/capiApi';
import { useCAPIStore } from '@/store/capiStore';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { CAPIProvider, CAPIProviderConfig } from '@/types/capi';

const PROVIDER_LABELS: Record<string, string> = {
  meta:     'Meta (Facebook)',
  google:   'Google Ads',
  tiktok:   'TikTok',
  linkedin: 'LinkedIn',
  snapchat: 'Snapchat',
};

const STATUS_COLORS: Record<string, string> = {
  draft:   'bg-gray-100 text-gray-600',
  testing: 'bg-yellow-100 text-yellow-700',
  active:  'bg-green-100 text-green-700',
  paused:  'bg-orange-100 text-orange-700',
  error:   'bg-red-100 text-red-700',
};

interface ProviderListProps {
  onAddProvider: (provider: CAPIProvider) => void;
  onSelectProvider: (id: string) => void;
}

const ADDABLE_PROVIDERS: Array<{ value: CAPIProvider; label: string }> = [
  { value: 'meta',   label: 'Meta (Facebook)' },
  { value: 'google', label: 'Google Ads' },
];

export function ProviderList({ onAddProvider, onSelectProvider }: ProviderListProps) {
  const {
    providers, providersLoading, providersError,
    setProviders, setProvidersLoading, setProvidersError, removeProvider,
  } = useCAPIStore();

  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    setProvidersLoading(true);
    capiApi.listProviders()
      .then(setProviders)
      .catch(err => setProvidersError(err instanceof Error ? err.message : String(err)))
      .finally(() => setProvidersLoading(false));
  }, [setProviders, setProvidersLoading, setProvidersError]);

  async function handleDelete(id: string) {
    try {
      await capiApi.deleteProvider(id);
      removeProvider(id);
    } catch {
      // silent — user will see the item still listed
    }
  }

  function openPicker() { setPickerOpen(true); }
  function closePicker() { setPickerOpen(false); }
  function selectProvider(provider: CAPIProvider) {
    closePicker();
    onAddProvider(provider);
  }

  if (providersLoading) {
    return <div className="text-sm text-muted-foreground py-8 text-center">Loading providers…</div>;
  }

  return (
    <div className="space-y-4">
      {providersError && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">{providersError}</div>
      )}

      {/* Provider picker overlay */}
      {pickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <Card className="w-80 shadow-xl">
            <CardContent className="py-6 space-y-4">
              <p className="text-sm font-medium text-center">Choose a provider to connect</p>
              <div className="flex flex-col gap-2">
                {ADDABLE_PROVIDERS.map((p) => (
                  <Button
                    key={p.value}
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => selectProvider(p.value)}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
              <Button variant="ghost" size="sm" className="w-full" onClick={closePicker}>
                Cancel
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {providers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-14 gap-4 text-center">
            <p className="text-muted-foreground text-sm">No CAPI providers configured yet.</p>
            <Button onClick={openPicker}>Connect a provider</Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex justify-end">
            <Button size="sm" onClick={openPicker}>+ Add provider</Button>
          </div>
          <div className="space-y-3">
            {providers.map((p: CAPIProviderConfig) => (
              <Card key={p.id} className="cursor-pointer hover:border-brand-400 transition-colors" onClick={() => onSelectProvider(p.id)}>
                <CardContent className="flex items-center justify-between py-4 px-5">
                  <div className="flex items-center gap-4">
                    <div>
                      <p className="font-medium text-sm">{PROVIDER_LABELS[p.provider] ?? p.provider}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.event_mapping.length} event{p.event_mapping.length !== 1 ? 's' : ''} mapped
                        {' · '}{p.events_sent_total.toLocaleString()} sent
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_COLORS[p.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {p.status}
                    </span>
                    <button
                      className="text-muted-foreground hover:text-red-600 text-sm transition-colors"
                      onClick={e => { e.stopPropagation(); void handleDelete(p.id); }}
                      title="Delete provider"
                    >
                      ✕
                    </button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
