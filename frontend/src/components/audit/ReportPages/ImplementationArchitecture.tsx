import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type {
  ReportJSON,
  DeclaredPlatform,
  ImplementationPath,
  ImplementationPathRow,
  UnattributedImplementationRow,
  DuplicateImplementationFinding,
} from '@/types/audit';

/** Signal vs Implementation PRD P1-05 — display labels for the full DeclaredPlatform union (mirrors backend platformDetection.ts's PLATFORM_LABELS). */
const DECLARED_PLATFORM_LABELS: Record<DeclaredPlatform, string> = {
  google_ads: 'Google Ads',
  meta: 'Meta',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  microsoft: 'Microsoft',
  reddit: 'Reddit',
  pinterest: 'Pinterest',
  openai: 'OpenAI (ChatGPT Ads)',
};

const IMPLEMENTATION_PATH_LABELS: Partial<Record<ImplementationPath, string>> = {
  GTM: 'Google Tag Manager',
  DIRECT_SCRIPT: "Platform's own script (direct)",
  SHOPIFY_WEB_PIXEL: 'Shopify Web Pixels Manager sandbox',
  SHOPIFY_APP_PIXEL: 'Shopify app pixel',
  SHOPIFY_CUSTOM_PIXEL: 'Shopify custom pixel',
  SHOPIFY_THEME: 'Shopify theme pixel',
  SERVER_SIDE: 'Server-side',
  HYBRID: 'Multiple mechanisms (ambiguous)',
};

function platformLabel(platform: DeclaredPlatform): string {
  return DECLARED_PLATFORM_LABELS[platform] ?? platform;
}

function pathLabel(path: ImplementationPath): string {
  return IMPLEMENTATION_PATH_LABELS[path] ?? path;
}

function DuplicateRow({ finding }: { finding: DuplicateImplementationFinding }) {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {platformLabel(finding.platform)} — {finding.page.replace(/_/g, ' ')}
        </p>
        <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Duplicate</Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{finding.paths.map(pathLabel).join(' + ')}</p>
    </div>
  );
}

function PathRow({ row }: { row: ImplementationPathRow }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {platformLabel(row.platform)} — {row.page.replace(/_/g, ' ')}
        </p>
        <span className="text-xs text-muted-foreground">
          {pathLabel(row.path)} · {row.confidence === 'high' ? 'High confidence' : 'Medium confidence'}
        </span>
      </div>
      {row.evidence.length > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">{row.evidence.join(' · ')}</p>
      )}
    </div>
  );
}

function UnattributedRow({ row }: { row: UnattributedImplementationRow }) {
  return (
    <div className="rounded-lg border border-dashed p-3">
      <p className="text-sm font-medium">
        {platformLabel(row.platform)} — {row.page.replace(/_/g, ' ')}
      </p>
      {row.evidence.length > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">{row.evidence.join(' · ')}</p>
      )}
    </div>
  );
}

interface Props {
  report: ReportJSON;
}

/**
 * Signal vs Implementation PRD P1-05 — how each declared platform's signal
 * actually reaches the network (GTM, a directly-loaded script, or a
 * Shopify Web Pixels Manager sandbox), plus P1-06's duplicate-implementation
 * findings. The parent report page (ReportTabs.tsx) only renders this tab
 * when report.implementation_architecture is present, matching Signals in
 * Conflict/Not Assessed/With Access's convention, so this component doesn't
 * need its own empty state.
 */
export function ImplementationArchitecture({ report }: Props) {
  const architecture = report.implementation_architecture;
  if (!architecture) return null;

  const { paths, unattributed, duplicates } = architecture;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Implementation Architecture</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          How each platform's signal actually reaches the network on this site — Google Tag Manager, a directly-loaded script, or (on a Shopify-backed site) a Shopify Web Pixels Manager sandbox.
        </p>
      </div>

      {duplicates.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Duplicate Implementations Found ({duplicates.length})</CardTitle>
            <p className="text-sm text-muted-foreground">
              More than one delivery mechanism was observed reaching the same page for the same platform — worth checking for duplicate event delivery.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {duplicates.map((finding, i) => (
              <DuplicateRow key={i} finding={finding} />
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Implementation Paths</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {paths.length === 0 ? (
            <p className="text-sm text-muted-foreground">No platform signal could be confidently attributed to a specific delivery mechanism during this scan.</p>
          ) : (
            paths.map((row, i) => <PathRow key={i} row={row} />)
          )}
        </CardContent>
      </Card>

      {unattributed.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Not Attributed</CardTitle>
            <p className="text-sm text-muted-foreground">
              Signal was observed, but the delivery mechanism could not be confidently determined from this scan.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {unattributed.map((row, i) => (
              <UnattributedRow key={i} row={row} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
