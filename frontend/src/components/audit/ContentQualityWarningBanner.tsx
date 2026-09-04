import { AlertTriangle } from 'lucide-react';
import type { ReportJSON } from '@/types/audit';

interface Props {
  warning: NonNullable<ReportJSON['content_quality_warning']>;
}

/**
 * Rendered when the backend's pre-render placeholder guard
 * (PRD "Signal Health Report" Issue 4) flags literal placeholder-shaped
 * text somewhere in the report. Non-fatal by design — the report still
 * renders in full below this banner; see placeholderGuard.ts's docstring
 * for why flag-not-block is the default.
 */
export function ContentQualityWarningBanner({ warning }: Props) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3" role="alert">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-amber-800">
          This report may contain unfilled placeholder text
        </p>
        <p className="mt-0.5 text-xs text-amber-700">
          {warning.flagged_fields.length} field{warning.flagged_fields.length === 1 ? '' : 's'} looked like they still carry example/placeholder copy rather than real content. The rest of this report is unaffected — flag it to your Atlas contact so the specific rule's text can be fixed.
        </p>
      </div>
    </div>
  );
}
