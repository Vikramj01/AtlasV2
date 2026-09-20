// ReadinessPanel — surfaces the §6.2 readiness check's four verdicts for a
// crm_sync_configs row, and gates the sync_enabled toggle on READY exactly
// as the backend's PATCH /api/crm/configs/:id handler already enforces
// server-side (this is a UX convenience, not the actual gate).

import { useEffect } from 'react';
import { Loader2, CheckCircle2, AlertTriangle, HelpCircle, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useOutcomesStore } from '@/store/outcomesStore';
import type { OutcomeSourceConfig, ReadinessVerdict } from '@/types/outcomes';

interface ReadinessPanelProps {
  config: OutcomeSourceConfig;
}

const VERDICT_CONFIG: Record<ReadinessVerdict, { label: string; icon: typeof CheckCircle2; className: string }> = {
  READY: { label: 'Ready', icon: CheckCircle2, className: 'text-severity-success bg-severity-success-bg' },
  PROPERTIES_PRESENT_NO_DATA: { label: 'Properties present, no data yet', icon: AlertTriangle, className: 'text-severity-warning bg-severity-warning-bg' },
  PROPERTIES_ABSENT: { label: 'Properties not yet set up', icon: XCircle, className: 'text-severity-warning bg-severity-warning-bg' },
  NOT_OBSERVED: { label: 'Not yet observed', icon: HelpCircle, className: 'text-severity-info bg-severity-info-bg' },
};

export function ReadinessPanel({ config }: ReadinessPanelProps) {
  const { readiness, loading, errors, checkReadiness, setSyncEnabled, setWriteBackEnabled } = useOutcomesStore();

  const result = readiness[config.id];
  const checking = loading[`readiness-${config.id}`] ?? false;
  const checkError = errors[`readiness-${config.id}`];
  const togglingSync = loading[`sync-enabled-${config.id}`] ?? false;
  const togglingWriteBack = loading[`write-back-enabled-${config.id}`] ?? false;

  useEffect(() => {
    checkReadiness(config.id).catch(() => { /* surfaced via errors[] */ });
    // Re-run only when the config identity changes, not on every readiness update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.id]);

  async function handleToggleSync() {
    try {
      await setSyncEnabled(config.id, !config.sync_enabled);
    } catch {
      // surfaced via errors[] below
    }
  }

  async function handleToggleWriteBack() {
    try {
      await setWriteBackEnabled(config.id, !config.write_back_enabled);
    } catch {
      // surfaced via errors[] below
    }
  }

  const verdictInfo = result ? VERDICT_CONFIG[result.verdict] : null;
  const VerdictIcon = verdictInfo?.icon;
  const syncToggleError = errors[`sync-enabled-${config.id}`];
  const writeBackToggleError = errors[`write-back-enabled-${config.id}`];

  return (
    <Card className="border-console-border bg-console-surface">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-base text-console-fg">Identity Readiness</CardTitle>
        <Button size="sm" variant="outline" onClick={() => checkReadiness(config.id)} disabled={checking}>
          {checking ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
          Re-check
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {checking && !result ? (
          <div className="flex items-center gap-2 text-sm text-console-fg-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking identity properties on the connected portal…
          </div>
        ) : checkError ? (
          <p className="text-sm text-severity-critical">{checkError}</p>
        ) : result && verdictInfo && VerdictIcon ? (
          <>
            <div className={`flex items-start gap-2 rounded-lg p-3 ${verdictInfo.className}`}>
              <VerdictIcon className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium">{verdictInfo.label}</p>
                <p className="text-xs mt-0.5">{result.message}</p>
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <dt className="text-console-fg-muted">Present properties</dt>
                <dd className="text-console-fg">{result.present_properties.length > 0 ? result.present_properties.join(', ') : '—'}</dd>
              </div>
              <div>
                <dt className="text-console-fg-muted">Not yet observed</dt>
                <dd className="text-console-fg">{result.missing_properties.length > 0 ? result.missing_properties.join(', ') : '—'}</dd>
              </div>
              <div>
                <dt className="text-console-fg-muted">Sample size</dt>
                <dd className="text-console-fg">{result.sample_size} record{result.sample_size !== 1 ? 's' : ''}</dd>
              </div>
            </dl>

            <div className="pt-2 border-t border-console-border flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-console-fg">
                  {config.sync_enabled ? 'Sync is enabled' : 'Sync is off'}
                </p>
                {result.verdict !== 'READY' && !config.sync_enabled && (
                  <p className="text-xs text-console-fg-muted">Enabling sync requires a READY readiness verdict.</p>
                )}
              </div>
              <Button
                size="sm"
                variant={config.sync_enabled ? 'outline' : 'default'}
                onClick={handleToggleSync}
                disabled={togglingSync || (!config.sync_enabled && result.verdict !== 'READY')}
              >
                {togglingSync ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                {config.sync_enabled ? 'Disable sync' : 'Enable sync'}
              </Button>
            </div>
            {syncToggleError && <p className="text-xs text-severity-critical">{syncToggleError}</p>}

            <div className="pt-2 border-t border-console-border flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-console-fg">
                  {config.write_back_enabled ? 'Attribution write-back is enabled' : 'Attribution write-back is off'}
                </p>
                <p className="text-xs text-console-fg-muted">
                  Off by default. When enabled, Atlas writes the source platform, delivered
                  Atlas events, and last-delivered timestamp back onto the CRM record in
                  Atlas-namespaced properties only — never a standard CRM field.
                </p>
              </div>
              <Button
                size="sm"
                variant={config.write_back_enabled ? 'outline' : 'default'}
                onClick={handleToggleWriteBack}
                disabled={togglingWriteBack}
              >
                {togglingWriteBack ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                {config.write_back_enabled ? 'Disable write-back' : 'Enable write-back'}
              </Button>
            </div>
            {writeBackToggleError && <p className="text-xs text-severity-critical">{writeBackToggleError}</p>}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
