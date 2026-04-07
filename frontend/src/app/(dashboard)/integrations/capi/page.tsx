/**
 * CAPI Integrations Page — /integrations/capi
 *
 * Two-tab layout:
 *   - Realtime CAPI: existing ProviderList + SetupWizard + MonitoringDashboard
 *   - Offline Conversions: new CSV-based offline upload module
 */

import { useState } from 'react';
import { ProviderList } from '@/components/capi/ProviderList';
import { SetupWizard } from '@/components/capi/SetupWizard';
import { CAPIMonitoringDashboard } from '@/components/capi/CAPIMonitoringDashboard';
import { OfflineConversionsTab } from '@/components/capi/offline/OfflineConversionsTab';
import { useCAPIStore } from '@/store/capiStore';
import type { CAPIProvider } from '@/types/capi';

type PageTab = 'realtime' | 'offline';

export default function CAPIPage() {
  const [activeTab, setActiveTab] = useState<PageTab>('realtime');
  const { wizardOpen, wizardStep, openWizard, closeWizard, setProviders, selectProvider, selectedProviderId } = useCAPIStore();

  // ── Realtime CAPI: wizard flow ─────────────────────────────────────────────

  function handleAddProvider(provider: CAPIProvider) {
    openWizard(provider);
  }

  function handleWizardComplete() {
    closeWizard();
    // Re-fetch providers after wizard completes
    import('@/lib/api/capiApi').then(({ capiApi }) => {
      capiApi.listProviders().then(setProviders).catch(() => {});
    });
  }

  // ── Realtime CAPI tab content ─────────────────────────────────────────────

  function renderRealtimeTab() {
    if (wizardOpen) {
      return (
        <SetupWizard
          onComplete={handleWizardComplete}
          onCancel={() => {
            closeWizard();
            // If we created a provider (step > 1), go back to list — don't lose it
            if (wizardStep > 1) {
              import('@/lib/api/capiApi').then(({ capiApi }) => {
                capiApi.listProviders().then(setProviders).catch(() => {});
              });
            }
          }}
        />
      );
    }

    if (selectedProviderId) {
      return (
        <div className="mt-6 space-y-4">
          <button
            type="button"
            onClick={() => selectProvider(null)}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            ← Back to providers
          </button>
          <CAPIMonitoringDashboard providerId={selectedProviderId} />
        </div>
      );
    }

    return (
      <div className="mt-6">
        <ProviderList
          onAddProvider={handleAddProvider}
          onSelectProvider={(id) => selectProvider(id)}
        />
      </div>
    );
  }

  return (
    <div className="px-6 py-6 max-w-5xl mx-auto">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Conversion APIs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Send conversion signals to ad platforms to improve campaign optimisation.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-0 border-b border-[#E5E7EB]">
        {([
          { key: 'realtime' as const, label: 'Realtime CAPI' },
          { key: 'offline' as const, label: 'Offline Conversions' },
        ]).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={[
              'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
              activeTab === key
                ? 'border-[#1B2A4A] text-[#1B2A4A]'
                : 'border-transparent text-muted-foreground hover:text-[#1A1A1A]',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'realtime' && renderRealtimeTab()}
      {activeTab === 'offline' && <OfflineConversionsTab />}
    </div>
  );
}
