/**
 * Offline Conversions Tab
 *
 * Main content for the "Offline Conversions" tab in the CAPI integrations page.
 *
 * Top-level states:
 *   - Loading: skeleton while fetching config
 *   - Config error: red banner
 *   - Not configured: "Get started" empty state → opens wizard
 *   - Wizard open: full-page OfflineSetupWizard
 *   - Configured: two sub-panels
 *       • Upload panel  (uploadPhase drives which sub-component renders)
 *       • GCLID capture panel (always visible below)
 *
 * Upload phases (within the configured view):
 *   'idle'       → UploadArea (drag-and-drop)
 *   'reviewing'  → ValidationReview (confirm / cancel)
 *   'processing' → UploadProgress (polling)
 *   'done'       → UploadResults (success / partial / failed)
 *   'history'    → UploadHistory (paginated table)
 */

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { offlineConversionsApi } from '@/lib/api/offlineConversionsApi';
import { useOfflineConversionsStore } from '@/store/offlineConversionsStore';
import { OfflineSetupWizard } from './SetupWizard';
import { GCLIDCapturePanel } from './GCLIDCapturePanel';
import { UploadArea } from './UploadArea';
import { ValidationReview } from './ValidationReview';
import { UploadProgress } from './UploadProgress';
import { UploadResults } from './UploadResults';
import { UploadHistory } from './UploadHistory';
import type { UploadValidationResponse, OfflineConversionRow, ValidationSummary, OfflineConversionUpload } from '@/types/offline-conversions';

// ── Upload phase machine ──────────────────────────────────────────────────────

type UploadPhase = 'idle' | 'reviewing' | 'processing' | 'done' | 'history';

interface ReviewState {
  upload: OfflineConversionUpload;
  summary: ValidationSummary;
  errorSample: OfflineConversionRow[];
}

const STATUS_COLOR: Record<string, string> = {
  active:  'bg-green-100 text-green-700',
  paused:  'bg-orange-100 text-orange-700',
  error:   'bg-red-100 text-red-700',
};

// ── Component ─────────────────────────────────────────────────────────────────

export function OfflineConversionsTab() {
  const {
    config, configLoading, configError,
    setConfig, setConfigLoading, setConfigError,
    wizardOpen, openWizard, closeWizard,
    activeUpload, setActiveUpload, clearActiveUpload,
    uploadError,
  } = useOfflineConversionsStore();

  const [uploadPhase, setUploadPhase] = useState<UploadPhase>('idle');
  const [reviewState, setReviewState] = useState<ReviewState | null>(null);
  const [completedUpload, setCompletedUpload] = useState<OfflineConversionUpload | null>(null);

  // ── Fetch config on mount ─────────────────────────────────────────────────

  useEffect(() => {
    setConfigLoading(true);
    setConfigError(null);
    offlineConversionsApi.getConfig()
      .then(setConfig)
      .catch((err: Error) => {
        if (!err.message.includes('CONFIG_NOT_FOUND') && !err.message.includes('404')) {
          setConfigError(err.message);
        }
        setConfig(null);
      })
      .finally(() => setConfigLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleValidated(response: UploadValidationResponse) {
    // We need the full upload object — reconstruct a minimal one from the response
    // The real upload object will be fetched during polling; use what we have for now
    const minimalUpload = {
      id: response.upload_id,
      status: 'validated',
      filename: '',          // filled in by polling
      file_size_bytes: 0,
      row_count_total: response.validation_summary.total_rows,
      row_count_valid: response.validation_summary.valid_rows,
      row_count_invalid: response.validation_summary.invalid_rows,
      row_count_duplicate: response.validation_summary.duplicate_rows,
      row_count_uploaded: 0,
      row_count_rejected: 0,
      organization_id: '',
      config_id: '',
      validation_summary: response.validation_summary,
      upload_result: null,
      error_message: null,
      uploaded_by: '',
      created_at: new Date().toISOString(),
      validated_at: new Date().toISOString(),
      confirmed_at: null,
      processing_started_at: null,
      completed_at: null,
      updated_at: new Date().toISOString(),
    } as OfflineConversionUpload;

    setReviewState({
      upload: minimalUpload,
      summary: response.validation_summary,
      errorSample: response.error_sample,
    });
    setActiveUpload(minimalUpload);
    setUploadPhase('reviewing');
  }

  function handleReviewConfirmed() {
    setUploadPhase('processing');
  }

  function handleReviewCancel() {
    clearActiveUpload();
    setReviewState(null);
    setUploadPhase('idle');
  }

  function handleProcessingComplete(upload: OfflineConversionUpload) {
    setCompletedUpload(upload);
    setUploadPhase('done');
  }

  function handleUploadAnother() {
    clearActiveUpload();
    setReviewState(null);
    setCompletedUpload(null);
    setUploadPhase('idle');
  }

  function handleViewHistory() {
    clearActiveUpload();
    setReviewState(null);
    setCompletedUpload(null);
    setUploadPhase('history');
  }

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

  // ── Config error ──────────────────────────────────────────────────────────

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

      {/* Upload panel */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-sm font-semibold">Upload conversions</CardTitle>
          <div className="flex items-center gap-2">
            {uploadPhase !== 'history' && (
              <button
                type="button"
                onClick={handleViewHistory}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                View history
              </button>
            )}
            {uploadPhase === 'history' && (
              <button
                type="button"
                onClick={() => setUploadPhase('idle')}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                ← Back to upload
              </button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => offlineConversionsApi.downloadTemplate().catch(() => {})}
            >
              Download Template
            </Button>
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          {/* Upload-level error banner (from store, e.g. confirm failure) */}
          {uploadError && uploadPhase !== 'idle' && (
            <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 flex items-start gap-2">
              <span className="mt-0.5">⚠</span>
              <span>{uploadError}</span>
            </div>
          )}

          {uploadPhase === 'idle' && (
            <UploadArea onValidated={handleValidated} />
          )}

          {uploadPhase === 'reviewing' && reviewState && (
            <ValidationReview
              upload={reviewState.upload}
              summary={reviewState.summary}
              errorSample={reviewState.errorSample}
              onConfirmed={handleReviewConfirmed}
              onCancel={handleReviewCancel}
            />
          )}

          {uploadPhase === 'processing' && activeUpload && (
            <UploadProgress
              upload={activeUpload}
              onComplete={handleProcessingComplete}
            />
          )}

          {uploadPhase === 'done' && completedUpload && (
            <UploadResults
              upload={completedUpload}
              onUploadAnother={handleUploadAnother}
              onViewHistory={handleViewHistory}
            />
          )}

          {uploadPhase === 'history' && (
            <UploadHistory onStartUpload={() => setUploadPhase('idle')} />
          )}
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
