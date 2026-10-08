import type { ReportJSON } from '@/types/audit';

interface Props {
  report: ReportJSON;
}

/**
 * L11 Reconciliation (GA4 Admin / L11 / Junk Gate PRD §B.5) — "Against your
 * connected platforms". DISCLOSURE ONLY: these observations are about the
 * client's connected ad platforms, not the scan, and never count toward any
 * score or issue count. The parent only renders this tab when
 * report.reconciliation_disclosure is present (L11 skipped for a bare-URL or
 * public scan, or a client with no completed reconciliation run), so this
 * component has no empty state — and no empty heading ever shows.
 */
export function AgainstConnectedPlatforms({ report }: Props) {
  const disclosure = report.reconciliation_disclosure;
  if (!disclosure) return null;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Against Your Connected Platforms</h2>
        <p className="mt-1 text-sm text-muted-foreground">{disclosure.notice}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Based on the most recent reconciliation run, completed {disclosure.run_completed_at.slice(0, 10)}{' '}
          ({disclosure.run_age_days} day{disclosure.run_age_days === 1 ? '' : 's'} before this report)
          {disclosure.stale ? ' — older than a week, so current platform state may differ.' : '.'}
        </p>
      </div>

      <ul className="space-y-3">
        {disclosure.items.map((item) => (
          <li
            key={item.rule_id}
            className={`rounded-xl border px-5 py-4 ${item.outcome === 'flagged' ? 'border-amber-200 bg-amber-50' : 'bg-muted/30'}`}
          >
            <p className={`text-sm font-semibold ${item.outcome === 'flagged' ? 'text-amber-950' : 'text-foreground'}`}>
              {item.label}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {item.outcome === 'flagged' ? 'Needs attention' : 'Nothing unresolved observed'}
              </span>
            </p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{item.summary}</p>
            {item.details.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-foreground">
                {item.details.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      {disclosure.context_notes.length > 0 && (
        <div className="rounded-xl border bg-muted/30 px-5 py-4">
          <p className="text-sm font-semibold text-foreground">Context</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-muted-foreground">
            {disclosure.context_notes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
