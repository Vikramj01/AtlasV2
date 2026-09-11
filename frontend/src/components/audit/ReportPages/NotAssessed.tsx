import type { ReportJSON } from '@/types/audit';

interface Props {
  report: ReportJSON;
}

/**
 * Pre-Connection Scan Confidence Tiering PRD §11.2 item 5 ("Not assessed,
 * and why") — findings excluded from every count and score because the
 * crawl couldn't confidently assess them (a step substituted with the
 * landing page, a run that didn't fully settle, a cross-signal conflict).
 * "Suppress, do not annotate": these never appear as findings elsewhere in
 * the report. The parent report page only renders this tab when
 * report.could_not_be_assessed is present and non-empty, matching Open
 * Questions' convention, so this component doesn't need its own empty state.
 */
export function NotAssessed({ report }: Props) {
  const findings = report.could_not_be_assessed ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Not Assessed, and Why</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          These checks are excluded from every count and score in this report — each one names its own reason below, rather than being reported as a finding.
        </p>
      </div>

      <ul className="space-y-3">
        {findings.map((finding, i) => (
          <li key={i} className="rounded-xl border bg-muted/30 px-5 py-4">
            <p className="text-sm font-medium text-foreground">{finding.rule_id.replace(/_/g, ' ')}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{finding.reason}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
