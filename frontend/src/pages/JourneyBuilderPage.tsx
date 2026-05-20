import { JourneyWizard } from '@/components/journey/JourneyWizard';
import { SECTION_LABELS } from '@/lib/ui-copy';

export function JourneyBuilderPage() {
  return (
    <div>
      <div className="mx-auto max-w-2xl px-4 pt-10 pb-2">
        <h1 className="text-2xl font-bold tracking-tight">
          {SECTION_LABELS.journeyBuilder.primary}
          <span className="ml-2 text-sm font-normal text-muted-foreground">{SECTION_LABELS.journeyBuilder.technical}</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Define your customer journey stages and events manually, then export a GTM container your developer can import directly.
          If you'd prefer Atlas to detect events automatically, use the <span className="font-medium text-foreground">AI Site Scan</span>.
        </p>
      </div>
      <JourneyWizard />
    </div>
  );
}
