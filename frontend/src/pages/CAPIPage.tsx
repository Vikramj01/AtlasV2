/**
 * CAPIPage — /integrations/capi
 *
 * Top-level Conversions API integration page.
 * Three views (controlled by local state):
 *   1. Provider list  — default
 *   2. Setup wizard   — "Add provider" opens the 5-step wizard inline
 *   3. Dashboard      — clicking an existing provider card shows its analytics
 */

import { useState } from 'react';
import { InfoTooltip } from '@/components/common/EducationTooltip';
import { ProviderList } from '@/components/capi/ProviderList';
import { SetupWizard } from '@/components/capi/SetupWizard';
import { CAPIMonitoringDashboard } from '@/components/capi/CAPIMonitoringDashboard';
import { useCAPIStore } from '@/store/capiStore';
import { capiApi } from '@/lib/api/capiApi';
import type { CAPIProvider, CAPIProviderConfig } from '@/types/capi';

type View = 'list' | 'wizard' | 'dashboard';

export function CAPIPage() {
  const [view, setView] = useState<View>('list');
  const [selectedProvider, setSelectedProvider] = useState<CAPIProviderConfig | null>(null);

  const { openWizard, closeWizard, setProviders, selectProvider, providers } = useCAPIStore();

  function handleAddProvider(provider: CAPIProvider) {
    openWizard(provider);
    setView('wizard');
  }

  function handleSelectProvider(id: string) {
    // Try to get full provider details (includes status/events_sent_total)
    capiApi.getProvider(id).then((provider) => {
      setSelectedProvider(provider);
      selectProvider(id);
      setView('dashboard');
    }).catch(() => {
      // Fallback: use cached provider from the store list
      const cached = providers.find((p) => p.id === id);
      if (cached) {
        setSelectedProvider(cached);
        selectProvider(id);
        setView('dashboard');
      }
    });
  }

  function handleWizardComplete() {
    setView('list');
    closeWizard();
    capiApi.listProviders().then(setProviders).catch(() => {});
  }

  function handleWizardCancel() {
    setView('list');
    closeWizard();
  }

  function handleBackFromDashboard() {
    setSelectedProvider(null);
    selectProvider(null);
    setView('list');
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 p-6">
      {view === 'wizard' && (
        <SetupWizard
          onComplete={handleWizardComplete}
          onCancel={handleWizardCancel}
        />
      )}

      {view === 'dashboard' && selectedProvider && (
        <CAPIMonitoringDashboard
          provider={selectedProvider}
          onBack={handleBackFromDashboard}
        />
      )}

      {view === 'list' && (
        <>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">Conversions API</h1>
              <InfoTooltip contentKey="capi.why_server_side" />
            </div>
            <p className="text-muted-foreground text-sm mt-1">
              Send server-side conversion events directly to ad platforms. Improves attribution accuracy and fills gaps left by browser-side tracking.
            </p>
          </div>
          <ProviderList
            onAddProvider={handleAddProvider}
            onSelectProvider={handleSelectProvider}
          />
        </>
      )}
    </div>
  );
}
