/**
 * CAPIPage — /integrations/capi
 *
 * Top-level Conversions API integration page.
 * Shows the ProviderList and opens the SetupWizard inline.
 */

import { useState } from 'react';
import { ProviderList } from '@/components/capi/ProviderList';
import { SetupWizard } from '@/components/capi/SetupWizard';
import { useCAPIStore } from '@/store/capiStore';

export function CAPIPage() {
  const [showWizard, setShowWizard] = useState(false);
  const { openWizard, closeWizard, setProviders } = useCAPIStore();

  function handleAddProvider() {
    openWizard('meta');
    setShowWizard(true);
  }

  function handleWizardComplete() {
    setShowWizard(false);
    closeWizard();
    // Refresh provider list
    import('@/lib/api/capiApi').then(({ capiApi }) => {
      capiApi.listProviders().then(setProviders).catch(() => {});
    });
  }

  function handleWizardCancel() {
    setShowWizard(false);
    closeWizard();
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 p-6">
      {!showWizard ? (
        <>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Conversions API</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Send server-side conversion events directly to ad platforms. Improves attribution accuracy and fills gaps left by browser-side tracking.
            </p>
          </div>
          <ProviderList
            onAddProvider={handleAddProvider}
            onSelectProvider={(_id) => { /* Sprint 4: open dashboard */ }}
          />
        </>
      ) : (
        <SetupWizard
          onComplete={handleWizardComplete}
          onCancel={handleWizardCancel}
        />
      )}
    </div>
  );
}
