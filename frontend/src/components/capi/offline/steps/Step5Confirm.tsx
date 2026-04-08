/**
 * Offline Conversions Setup Wizard — Step 5: Confirm & Download Template
 *
 * Shows a provider-aware summary of the wizard configuration, saves it to
 * the backend, and prompts the user to download the CSV template.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { offlineConversionsApi } from '@/lib/api/offlineConversionsApi';
import { useOfflineConversionsStore } from '@/store/offlineConversionsStore';

interface Props {
  onComplete: () => void;
  onBack: () => void;
}

export function Step5Confirm({ onComplete, onBack }: Props) {
  const {
    wizardDraft,
    setWizardSaving,
    wizardSaving,
    wizardError,
    setWizardError,
    setConfig,
  } = useOfflineConversionsStore();

  const [saved, setSaved] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const isGoogle = wizardDraft.provider_type !== 'meta';

  async function handleSaveAndFinish() {
    setWizardSaving(true);
    setWizardError(null);
    try {
      const input = isGoogle
        ? {
            provider_type: wizardDraft.provider_type,
            capi_provider_id: wizardDraft.capi_provider_id,
            google_customer_id: wizardDraft.google_customer_id,
            conversion_action_id: wizardDraft.conversion_action_id,
            conversion_action_name: wizardDraft.conversion_action_name,
            column_mapping: wizardDraft.column_mapping,
            default_currency: wizardDraft.default_currency,
            default_conversion_value: wizardDraft.default_conversion_value,
          }
        : {
            provider_type: wizardDraft.provider_type,
            capi_provider_id: wizardDraft.capi_provider_id,
            meta_event_name: wizardDraft.meta_event_name,
            column_mapping: wizardDraft.column_mapping,
            default_currency: wizardDraft.default_currency,
            default_conversion_value: wizardDraft.default_conversion_value,
          };

      const config = await offlineConversionsApi.saveConfig(input);
      setConfig(config);
      setSaved(true);
    } catch (err) {
      setWizardError(err instanceof Error ? err.message : 'Failed to save configuration');
    } finally {
      setWizardSaving(false);
    }
  }

  async function handleDownloadTemplate() {
    setDownloading(true);
    try {
      await offlineConversionsApi.downloadTemplate();
    } catch {
      // non-fatal
    } finally {
      setDownloading(false);
    }
  }

  if (saved) {
    return (
      <div className="space-y-6 text-center">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-700 text-xl">
            ✓
          </div>
          <h3 className="text-base font-semibold">Offline conversions configured</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            Your setup is complete. Download the CSV template and populate it with your closed
            deals, then upload it from the Offline Conversions tab.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button variant="outline" onClick={handleDownloadTemplate} disabled={downloading}>
            {downloading ? 'Downloading…' : 'Download CSV Template'}
          </Button>
          <Button onClick={onComplete}>Go to Upload</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Review your configuration before saving. You can update it any time from the Offline
        Conversions tab settings.
      </p>

      {/* Config summary */}
      <div className="rounded-lg border border-input divide-y divide-input">
        <SummaryRow
          label="Platform"
          value={isGoogle ? 'Google Ads' : 'Meta (Facebook)'}
        />
        {isGoogle ? (
          <>
            <SummaryRow label="Google Ads Account" value={wizardDraft.google_customer_id || '—'} />
            <SummaryRow
              label="Conversion Action"
              value={
                wizardDraft.conversion_action_name ||
                wizardDraft.conversion_action_id.split('/').at(-1) ||
                '—'
              }
            />
          </>
        ) : (
          <SummaryRow label="Event Name" value={wizardDraft.meta_event_name || '—'} />
        )}
        <SummaryRow label="Default Currency" value={wizardDraft.default_currency || '—'} />
        <SummaryRow
          label="Default Value"
          value={
            wizardDraft.default_conversion_value != null
              ? `${wizardDraft.default_conversion_value.toLocaleString()} ${wizardDraft.default_currency}`
              : 'Per-row (no default)'
          }
        />
        <SummaryRow
          label="Column Mappings"
          value={`${Object.values(wizardDraft.column_mapping).filter(Boolean).length} fields mapped`}
        />
      </div>

      {wizardError && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {wizardError}
        </div>
      )}

      <div className="rounded-md bg-muted px-4 py-3 text-sm text-muted-foreground">
        After saving, download the CSV template and use it to export closed deals from your CRM.
        Upload the populated CSV from the Offline Conversions tab.
      </div>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack} disabled={wizardSaving}>
          Back
        </Button>
        <Button onClick={handleSaveAndFinish} disabled={wizardSaving}>
          {wizardSaving ? 'Saving…' : 'Save & Finish'}
        </Button>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-right max-w-[60%] truncate">{value}</span>
    </div>
  );
}
