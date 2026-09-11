import type { ReportJSON } from '@/types/audit';

interface Props {
  report: ReportJSON;
}

const CONNECTION_PLATFORM_LABELS: Record<string, string> = {
  google_ads: 'Google Ads',
  meta: 'Meta',
  tiktok: 'TikTok',
  ga4: 'Google Analytics 4',
  linkedin: 'LinkedIn',
};

/**
 * Pre-Connection Scan Confidence Tiering PRD §12/§11.2 item 6 — connected-
 * tier checks/modules that would resolve a real finding or open question
 * raised in this run, built server-side from reporting/withAccessRegistry.ts
 * (never aspirational — every entry references a real Atlas feature and
 * only appears when it resolves something this run actually raised). The
 * parent report page only renders this tab when report.with_access is
 * present and non-empty, so this component doesn't need its own empty state.
 */
export function WithAccess({ report }: Props) {
  const entries = report.with_access ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">With Access — What a Connected Scan Adds</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          These checks need read-only access to your ad accounts. None of the connections below write anything.
        </p>
      </div>

      <ul className="space-y-3">
        {entries.map((entry, i) => (
          <li key={i} className="rounded-xl border px-5 py-4">
            <p className="text-sm font-semibold text-foreground">{entry.check}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Needs: {entry.requires_connection.map((p) => CONNECTION_PLATFORM_LABELS[p] ?? p).join(', ')} (read-only)
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{entry.reveals}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
