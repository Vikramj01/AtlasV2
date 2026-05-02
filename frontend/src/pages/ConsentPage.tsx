/**
 * ConsentPage — /consent
 *
 * Consent Hub settings page.
 * Wrapped in AppLayout via App.tsx (has sidebar + topbar).
 */

import { useEffect, useState } from 'react';
import { ConsentSettings } from '@/components/consent/ConsentSettings';
import { SECTION_LABELS } from '@/lib/ui-copy';
import { MetricGuidance } from '@/components/shared/MetricGuidance';
import { consentRateGuidance } from '@/lib/guidance/metricGuidance';
import { healthApi } from '@/lib/api/healthApi';

export function ConsentPage() {
  const [consentPct, setConsentPct] = useState<number | null>(null);

  useEffect(() => {
    healthApi.getDashboard()
      .then((d) => setConsentPct(d.score?.consent_coverage ?? null))
      .catch(() => {});
  }, []);

  return (
    <div className="max-w-3xl mx-auto space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {SECTION_LABELS.consentHub.primary}
          <span className="text-muted-foreground text-sm font-normal ml-2">{SECTION_LABELS.consentHub.technical}</span>
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Configure your consent banner, Google Consent Mode v2 mapping, and review opt-in analytics.
        </p>
      </div>
      <MetricGuidance result={consentRateGuidance(consentPct)} collapsible />
      <ConsentSettings />
    </div>
  );
}
