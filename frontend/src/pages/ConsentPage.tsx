/**
 * ConsentPage — /consent
 *
 * Consent Hub settings page.
 * Wrapped in AppLayout via App.tsx (has sidebar + topbar).
 */

import { ConsentSettings } from '@/components/consent/ConsentSettings';

export function ConsentPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Consent Hub</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Configure your consent banner, Google Consent Mode v2 mapping, and review opt-in analytics.
        </p>
      </div>
      <ConsentSettings />
    </div>
  );
}
