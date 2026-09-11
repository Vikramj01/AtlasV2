import type { ReportJSON } from '@/types/audit';

interface Props {
  report: ReportJSON;
}

/**
 * Pre-Connection Scan Confidence Tiering PRD §6/§11.2 item 3 — two
 * independent detectors (a dataLayer gtag() call, the register's own
 * network-request matcher, the Site Setup tag inventory, a platform's
 * linker cookie) disagreeing about the same entity. Both readings shown,
 * no winner picked. The parent report page only renders this tab when
 * report.signal_conflicts is present and non-empty, so this component
 * doesn't need its own empty state.
 */
export function SignalsInConflict({ report }: Props) {
  const conflicts = report.signal_conflicts ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Signals in Conflict</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Two of our own detectors read the following differently. We're showing both readings rather than picking a winner.
        </p>
      </div>

      <ul className="space-y-3">
        {conflicts.map((conflict, i) => (
          <li key={i} className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
            <p className="text-sm font-semibold text-amber-950">{conflict.entity}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-amber-900">
              <span className="font-medium">{conflict.source_a}</span> reports: {conflict.reading_a}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-amber-900">
              <span className="font-medium">{conflict.source_b}</span> reports: {conflict.reading_b}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
