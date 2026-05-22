import { Button } from '@/components/ui/button';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useJourneyWizardStore, type TransportRoute } from '@/store/journeyWizardStore';
import type { WizardStage } from '@/types/journey';
import type { ConversionEventTiming } from '@/types/journey';

interface Step2_5PerEventRoutingProps {
  onNext: () => void;
  onBack: () => void;
}

const ROUTE_OPTIONS: { value: TransportRoute; label: string }[] = [
  { value: 'tag_only',         label: 'Tag only' },
  { value: 'gtm_destinations', label: 'GTM Destinations' },
  { value: 'dma_push',         label: 'DMA push' },
  { value: 'combination',      label: 'Tag + DMA' },
];

function recommendRoute(stage: WizardStage, stageTiming?: ConversionEventTiming): TransportRoute {
  // Proxy stages → tag_only
  if (stageTiming?.is_proxy) return 'tag_only';
  // High-value stages (proxyValueGbp > 0 or vendor_aware) → dma_push
  if (stage.proxyValueGbp && stage.proxyValueGbp > 0) return 'dma_push';
  // Long lag / deep lag → combination
  if (stageTiming && (stageTiming.lag_class === 'long_lag' || stageTiming.lag_class === 'deep_lag')) return 'combination';
  // Default → tag_only
  return 'tag_only';
}

function getRationale(route: TransportRoute): string {
  switch (route) {
    case 'tag_only':
      return 'Immediate event — tag-side delivery is sufficient for this stage.';
    case 'gtm_destinations':
      return 'Route via GTM server-side destinations for enhanced deduplication.';
    case 'dma_push':
      return 'High-value or CRM-stage event — push offline via Google Data Manager to preserve attribution.';
    case 'combination':
      return 'Long sales cycle — combine tag-side proxy with DMA offline backfill.';
  }
}

const NAVY = '#1B2A4A';

export function Step2_5PerEventRouting({ onNext, onBack }: Step2_5PerEventRoutingProps) {
  const { stages, stageTiming, transportRoutes, setTransportRoute } = useJourneyWizardStore();

  const stagesWithActions = stages.filter((s) => s.actions.length > 0);

  if (stagesWithActions.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Per-event transport routing</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose how each conversion event is delivered to the ad platforms.
          </p>
        </div>

        <div className="rounded-md border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Add events to your journey stages to configure routing.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <Button onClick={onNext} className="w-full" style={{ backgroundColor: NAVY }}>
            Next →
          </Button>
          <Button variant="ghost" onClick={onBack} className="w-full text-muted-foreground">
            <ChevronLeft className="mr-1 size-4" />
            Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Per-event transport routing</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose how each conversion event is delivered to the ad platforms. Atlas recommends a route based on event timing and value.
        </p>
      </div>

      <div className="space-y-4">
        {stagesWithActions.map((stage) => {
          const timing = stageTiming[stage.id];
          const recommended = recommendRoute(stage, timing);
          const selected = transportRoutes[stage.id] ?? recommended;

          return (
            <div
              key={stage.id}
              className="rounded-lg border border-border p-4 space-y-3"
            >
              {/* Stage header */}
              <div>
                <p className="font-semibold text-sm">{stage.label}</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {stage.actions.map((action) => (
                    <span
                      key={action}
                      className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                    >
                      {action}
                    </span>
                  ))}
                </div>
              </div>

              {/* Recommendation badge */}
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Atlas recommendation: </span>
                {getRationale(recommended)}
              </p>

              {/* Route selector buttons */}
              <div className="flex flex-wrap gap-2">
                {ROUTE_OPTIONS.map((opt) => {
                  const isSelected = selected === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setTransportRoute(stage.id, opt.value)}
                      className={cn(
                        'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                        isSelected
                          ? 'border-transparent text-white'
                          : 'border-border hover:border-muted-foreground/50 hover:bg-muted/50',
                      )}
                      style={isSelected ? { backgroundColor: NAVY } : undefined}
                    >
                      {opt.label}
                      {opt.value === recommended && !isSelected && (
                        <span className="ml-1 text-muted-foreground">(rec.)</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-3">
        <Button
          onClick={onNext}
          className="w-full"
          style={{ backgroundColor: NAVY }}
        >
          Next →
        </Button>
        <Button variant="ghost" onClick={onBack} className="w-full text-muted-foreground">
          <ChevronLeft className="mr-1 size-4" />
          Back
        </Button>
      </div>
    </div>
  );
}
