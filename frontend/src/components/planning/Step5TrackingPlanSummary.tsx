import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { usePlanningStore } from '@/store/planningStore';
import type { Platform } from '@/types/planning';

const PLATFORM_LABELS: Record<Platform, string> = {
  ga4:        'Google Analytics 4',
  google_ads: 'Google Ads',
  meta:       'Meta (Facebook/Instagram)',
  tiktok:     'TikTok Ads',
  sgtm:       'Server-side GTM',
};

const PLATFORM_ICONS: Record<Platform, string> = {
  ga4:        '📊',
  google_ads: '🎯',
  meta:       '📘',
  tiktok:     '🎵',
  sgtm:       '🖥️',
};

export function Step5TrackingPlanSummary() {
  const { currentSession, recommendations, pages, nextStep, prevStep } = usePlanningStore();

  const sessionId = currentSession?.id ?? '';
  const platforms = currentSession?.selected_platforms ?? [];

  const approved = recommendations.filter((r) => r.user_decision === 'approved' || r.user_decision === 'edited');
  const skipped  = recommendations.filter((r) => r.user_decision === 'skipped');

  const byPage = approved.reduce<Record<string, string[]>>((acc, rec) => {
    const page = pages.find((p) => p.id === rec.page_id);
    const pageLabel = page?.page_title ?? page?.url ?? rec.page_id;
    if (!acc[pageLabel]) acc[pageLabel] = [];
    acc[pageLabel].push(rec.event_name);
    return acc;
  }, {});

  const estimatedHours = Math.max(1, Math.ceil(approved.length * 0.5));

  void sessionId; // used by parent context

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <h2 className="mb-1 text-xl font-bold">Tracking Plan Summary</h2>
      <p className="mb-8 text-sm text-muted-foreground">
        Review your plan before Atlas generates the GTM container and implementation files.
      </p>

      <Card className="mb-6">
        <CardHeader className="pb-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Platforms</h3>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {platforms.map((p) => (
              <span
                key={p}
                className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium"
              >
                <span>{PLATFORM_ICONS[p]}</span>
                {PLATFORM_LABELS[p]}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Events to capture ({approved.length})
            </h3>
            <Badge className="bg-green-100 text-green-700 hover:bg-green-100">{approved.length} approved</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {approved.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events approved. Go back and approve at least one.</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(byPage).map(([pageLabel, events]) => (
                <div key={pageLabel}>
                  <p className="mb-1 text-xs font-medium text-muted-foreground truncate">{pageLabel}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {events.map((ev) => (
                      <span key={ev} className="rounded bg-[#EEF1F7] px-2 py-0.5 font-mono text-xs text-[#1B2A4A]">
                        {ev}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {skipped.length > 0 && (
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Skipped ({skipped.length})
            </h3>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {skipped.map((r) => (
                <span key={r.id} className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground line-through">
                  {r.event_name}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="mb-8">
        <CardHeader className="pb-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Estimated implementation effort
          </h3>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <span className="text-3xl font-bold">{estimatedHours}h</span>
            <div>
              <p className="text-sm text-muted-foreground">
                ~{approved.length} dataLayer.push() calls across {Object.keys(byPage).length} page
                {Object.keys(byPage).length !== 1 ? 's' : ''}
              </p>
              <p className="text-xs text-muted-foreground/70">
                Based on 30 min per event for a developer familiar with GTM.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={prevStep} className="text-muted-foreground">
          ← Back
        </Button>
        <Button
          onClick={nextStep}
          disabled={approved.length === 0}
          className="bg-[#1B2A4A] hover:bg-[#1B2A4A]"
        >
          Continue to Consent →
        </Button>
      </div>
    </div>
  );
}
