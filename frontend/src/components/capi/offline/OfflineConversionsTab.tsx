/**
 * Offline Conversions Tab
 *
 * Main content for the "Offline Conversions" tab in the CAPI integrations page.
 *
 * States:
 *   - Loading: skeleton while fetching config
 *   - Not configured: "Get started" empty state → opens wizard
 *   - Wizard open: renders OfflineSetupWizard full-page
 *   - Configured: config summary + upload CTA (Sprint 4) + GCLID panel
 */

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { offlineConversionsApi } from '@/lib/api/offlineConversionsApi';
import { useOfflineConversionsStore } from '@/store/offlineConversionsStore';
import { OfflineSetupWizard } from './SetupWizard';
import { GCLIDCapturePanel } from './GCLIDCapturePanel';

const STATUS_COLOR: Record<string, string> = {
  active:  'bg-green-100 text-green-700',
  paused:  'bg-orange-100 text-orange-700',
  error:   'bg-red-100 text-red-700',
};

export function OfflineConversionsTab() {
  const {
    config, configLoading, configError,
    setConfig, setConfigLoading, setConfigError,
    wizardOpen, openWizard, closeWizard,
  } = useOfflineConversionsStore();

  useEffect(() => {
    setConfigLoading(true);
    setConfigError(null);
    offlineConversionsApi.getConfig()
      .then(setConfig)
      .catch((err: Error) => {
        // 404 = not configured yet — not an error, just no config
        if (!err.message.includes('CONFIG_NOT_FOUND') && !err.message.includes('404')) {
          setConfigError(err.message);
        }
        setConfig(null);
      })
      .finally(() => setConfigLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Wizard view ───────────────────────────────────────────────────────────

  if (wizardOpen) {
    return (
      <OfflineSetupWizard
        onComplete={() => closeWizard()}
        onCancel={() => closeWizard()}
      />
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  if (configLoading) {
    return (
      <div className="space-y-4 mt-6">
        <div className="h-32 animate-pulse rounded-lg border bg-muted" />
        <div className="h-24 animate-pulse rounded-lg border bg-muted" />
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────

  if (configError) {
    return (
      <div className="mt-6 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
        Failed to load offline conversion config: {configError}
      </div>
    );
  }

  // ── Not configured — empty state ──────────────────────────────────────────

  if (!config) {
    return (
      <div className="mt-6 space-y-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-5 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-2xl">
              📊
            </div>
            <div className="space-y-1 max-w-sm">
              <h3 className="text-base font-semibold">Send closed deal data to Google Ads</h3>
              <p className="text-sm text-muted-foreground">
                Upload CSV exports of closed deals so Google can optimise your campaigns for
                revenue rather than form submissions. Typical improvement: 20–40% lead quality lift.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-4 text-center max-w-sm">
              <StatCallout value="~90%" label="match rate with GCLID" />
              <StatCallout value="90 days" label="upload lookback window" />
              <StatCallout value="2,000" label="rows per upload batch" />
            </div>
            <Button onClick={openWizard} size="lg">
              Set up offline conversions
            </Button>
          </CardContent>
        </Card>
        <GCLIDCapturePanel />
      </div>
    );
  }

  // ── Configured — main view ────────────────────────────────────────────────

  return (
    <div className="mt-6 space-y-6">
      {/* Config summary card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-sm font-semibold">Configuration</CardTitle>
          <div className="flex items-center gap-3">
            <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_COLOR[config.status] ?? 'bg-gray-100 text-gray-600'}`}>
              {config.status}
            </span>
            <Button variant="ghost" size="sm" onClick={openWizard}>
              Edit
            </Button>
          </div>
        </CardHeader>
        <CardContent className="divide-y divide-input">
          <ConfigRow label="Google Ads Account" value={config.google_customer_id} />
          <ConfigRow label="Conversion Action" value={config.conversion_action_name || config.conversion_action_id} />
          <ConfigRow label="Default Currency" value={config.default_currency} />
          <ConfigRow
            label="Default Value"
            value={
              config.default_conversion_value != null
                ? `${config.default_conversion_value.toLocaleString()} ${config.default_currency}`
                : 'Per-row'
            }
          />
        </CardContent>
      </Card>

      {/* Upload CTA (Sprint 4 — placeholder) */}
      <Card>
        <CardContent className="py-8 flex flex-col items-center gap-4 text-center">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">Upload a CSV of closed deals</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Export closed deals from your CRM and upload them here. Atlas validates, hashes PII,
              and sends conversions to Google Ads within the 90-day lookback window.
            </p>
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => offlineConversionsApi.downloadTemplate().catch(() => {})}
            >
              Download Template
            </Button>
            {/* Upload button wired in Sprint 4 */}
            <Button disabled title="Upload flow coming in Sprint 4">
              Upload CSV
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Max 10 MB per file · ~50,000 rows · CSV format only
          </p>
        </CardContent>
      </Card>

      {/* GCLID panel always visible */}
      <GCLIDCapturePanel />
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCallout({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-lg font-bold text-primary">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium max-w-[60%] truncate text-right">{value}</span>
    </div>
  );
}
