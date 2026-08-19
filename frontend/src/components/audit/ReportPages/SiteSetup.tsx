import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ReportJSON, DetectedTagSignal, DetectedTagPlatform } from '@/types/audit';

const TAG_PLATFORM_LABELS: Record<DetectedTagPlatform, string> = {
  ga4: 'Google Analytics 4',
  meta_pixel: 'Meta Pixel',
  google_ads: 'Google Ads',
  linkedin_insight: 'LinkedIn Insight Tag',
  tiktok_pixel: 'TikTok Pixel',
  microsoft_uet: 'Microsoft UET',
};

function DetectedBadge({ detected }: { detected: boolean }) {
  return (
    <Badge
      className={cn(
        detected
          ? 'bg-green-100 text-green-700 hover:bg-green-100'
          : 'bg-muted text-muted-foreground hover:bg-muted'
      )}
    >
      {detected ? 'Detected' : 'Not Detected'}
    </Badge>
  );
}

function TagRow({ tag }: { tag: DetectedTagSignal }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{TAG_PLATFORM_LABELS[tag.platform] ?? tag.platform}</p>
        {tag.detected && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {tag.ids.length > 0 ? `ID${tag.ids.length > 1 ? 's' : ''}: ${tag.ids.join(', ')} · ` : ''}
            {tag.hit_count} request{tag.hit_count === 1 ? '' : 's'} observed
          </p>
        )}
      </div>
      <DetectedBadge detected={tag.detected} />
    </div>
  );
}

interface Props {
  report: ReportJSON;
}

export function SiteSetup({ report }: Props) {
  const { site_setup } = report;

  if (!site_setup) {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-lg font-semibold">Site Setup</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            What tracking infrastructure we detected on your site.
          </p>
        </div>
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-sm text-muted-foreground">No site setup data available for this audit.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { gtm_container, tags, possible_server_side_gtm, datalayer_inventory } = site_setup;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Site Setup</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          What tracking infrastructure we detected on your site during this scan.
        </p>
      </div>

      {/* GTM Container */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Google Tag Manager Container</CardTitle>
            <DetectedBadge detected={gtm_container.detected} />
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {gtm_container.detected ? (
            <p className="font-mono text-sm">{gtm_container.container_ids.join(', ')}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              No GTM container script was observed loading on the scanned pages.
            </p>
          )}
          {gtm_container.connected_container_id && (
            <div className="flex flex-wrap items-center gap-2 border-t pt-2">
              <span className="text-xs text-muted-foreground">
                Connected container: <span className="font-mono">{gtm_container.connected_container_id}</span>
              </span>
              {gtm_container.ids_match === false && (
                <Badge className="bg-red-100 text-red-700 hover:bg-red-100">
                  Mismatch — live site loads a different container
                </Badge>
              )}
              {gtm_container.ids_match === true && (
                <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Matches connected container</Badge>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tags detected */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Tags &amp; Pixels Detected</CardTitle>
          <p className="text-sm text-muted-foreground">
            General presence, independent of whether a conversion event fired.
          </p>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {tags.map((tag) => (
              <TagRow key={tag.platform} tag={tag} />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Possible server-side GTM */}
      <Card className="border-amber-300">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Possible Server-Side GTM</CardTitle>
            <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">
              {possible_server_side_gtm.detected ? 'Possible Signal Found' : 'No Signal Found'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {possible_server_side_gtm.detected && (
            <>
              {possible_server_side_gtm.candidate_hosts.length > 0 && (
                <p className="font-mono text-xs">
                  Candidate host{possible_server_side_gtm.candidate_hosts.length > 1 ? 's' : ''}:{' '}
                  {possible_server_side_gtm.candidate_hosts.join(', ')}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Confidence: <span className="capitalize">{possible_server_side_gtm.confidence}</span>
              </p>
            </>
          )}
          <p className="text-xs italic text-muted-foreground">{possible_server_side_gtm.caveat ||
            'This is a best-effort heuristic based on request path/hostname shape, not a confirmed server-side GTM installation.'}</p>
        </CardContent>
      </Card>

      {/* DataLayer inventory */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Data Layer Inventory</CardTitle>
          <p className="text-sm text-muted-foreground">
            Events observed in window.dataLayer during this scan and the parameters each one carries.
          </p>
        </CardHeader>
        <CardContent>
          {datalayer_inventory.length === 0 ? (
            <p className="text-sm text-muted-foreground">No dataLayer events were observed.</p>
          ) : (
            <div className="space-y-3">
              {datalayer_inventory.map((entry) => (
                <div key={entry.event_name} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-mono text-sm font-semibold">{entry.event_name}</p>
                    <span className="text-xs text-muted-foreground">
                      {entry.occurrence_count} occurrence{entry.occurrence_count === 1 ? '' : 's'} · {entry.steps_seen.join(', ')}
                    </span>
                  </div>
                  {entry.parameter_keys.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {entry.parameter_keys.map((key) => (
                        <Badge key={key} variant="outline" className="font-mono text-xs">
                          {key}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
