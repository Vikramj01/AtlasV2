import { JourneyWizard } from '@/components/journey/JourneyWizard';
import { SECTION_LABELS } from '@/lib/ui-copy';

export function JourneyBuilderPage() {
  return (
    <div>
      <div className="mx-auto max-w-2xl px-4 pt-10 pb-2">
        <h1 className="text-2xl font-bold tracking-tight">
          {SECTION_LABELS.journeyBuilder.primary}
          <span className="text-muted-foreground text-sm font-normal ml-2">{SECTION_LABELS.journeyBuilder.technical}</span>
        </h1>
      </div>
      <JourneyWizard />
    </div>
  );
}
