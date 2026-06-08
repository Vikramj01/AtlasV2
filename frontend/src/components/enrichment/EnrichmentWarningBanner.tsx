import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface EnrichmentWarningBannerProps {
  missingCount: number;
  onConfigure: () => void;
  /** Set true when TIME_02 fires: physical_store signals with no identity fields configured */
  offlineIdentityMissing?: boolean;
}

export function EnrichmentWarningBanner({
  missingCount,
  onConfigure,
  offlineIdentityMissing,
}: EnrichmentWarningBannerProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-800">
            <span className="font-semibold">Signal enrichment not configured</span>
            {' — '}
            {missingCount === 1
              ? '1 conversion signal is'
              : `${missingCount} conversion signals are`}{' '}
            missing value and identity configuration. Without it, value-based bidding optimisation is unavailable.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={onConfigure}
          className="shrink-0 border-amber-300 text-amber-800 hover:bg-amber-100"
        >
          Configure →
        </Button>
      </div>

      {offlineIdentityMissing && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
          <p className="text-sm text-red-800">
            <span className="font-semibold">Offline identity fields missing</span>
            {' — '}
            one or more physical store signals are configured but no email or phone identity fields are
            mapped. Match rate for these signals will be zero. Configure identity fields to resolve this.
          </p>
        </div>
      )}
    </div>
  );
}
