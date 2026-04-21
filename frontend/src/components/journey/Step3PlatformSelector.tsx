import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Platform, ImplementationFormat } from '@/types/journey';
import { PLATFORM_OPTIONS } from '@/types/journey';
import { useJourneyWizardStore } from '@/store/journeyWizardStore';

interface Step3Props {
  onNext: () => void;
  onBack: () => void;
}

const FORMAT_OPTIONS: { value: ImplementationFormat; label: string; description: string }[] = [
  { value: 'gtm', label: 'Google Tag Manager', description: "Most common — we'll generate dataLayer.push() code and a GTM container JSON" },
];

export function Step3PlatformSelector({ onNext, onBack }: Step3Props) {
  const { platforms, implementationFormat, togglePlatform, setPlatformId, setImplementationFormat, canProceedFromStep } = useJourneyWizardStore();
  const canProceed = canProceedFromStep(3);

  return (
    <div>
      <h2 className="text-2xl font-bold text-center">
        Where do you send your tracking data?
      </h2>
      <p className="mt-2 text-center text-muted-foreground text-sm">
        Select the platforms you use. Platform IDs are optional — Atlas can detect them.
      </p>

      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {PLATFORM_OPTIONS.map((option) => {
          const selection = platforms.find((p) => p.platform === option.value)!;
          return (
            <div
              key={option.value}
              className={cn(
                'rounded-xl border-2 p-4 transition-all',
                selection.isActive ? 'border-[#1B2A4A] bg-[#EEF1F7]' : 'border-border bg-background'
              )}
            >
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selection.isActive}
                  onChange={() => togglePlatform(option.value as Platform)}
                  className="h-4 w-4 rounded border-gray-300 text-[#1B2A4A] focus:ring-[#1B2A4A]"
                />
                <div>
                  <span className="inline-block rounded bg-muted px-1.5 py-0.5 text-xs font-mono font-semibold mr-1">
                    {option.logo}
                  </span>
                  <span className="text-sm font-medium">{option.label}</span>
                </div>
              </label>

              {selection.isActive && (
                <div className="mt-3">
                  <Input
                    type="text"
                    value={selection.measurementId}
                    onChange={(e) => setPlatformId(option.value as Platform, e.target.value)}
                    placeholder={option.idPlaceholder}
                    className="h-7 text-xs"
                  />
                  <p className="mt-0.5 text-xs text-muted-foreground">{option.idLabel} (optional)</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!canProceed && (
        <p className="mt-3 text-center text-sm text-destructive">Select at least one platform to continue.</p>
      )}

      <div className="mt-8">
        <h3 className="text-sm font-semibold">How is tracking set up on your site?</h3>
        <div className="mt-3 space-y-2">
          {FORMAT_OPTIONS.map((fmt) => (
            <label key={fmt.value} className="flex items-start gap-3 cursor-pointer rounded-lg border p-3 hover:border-[#1B2A4A]/30 transition-colors">
              <input
                type="radio"
                value={fmt.value}
                checked={implementationFormat === fmt.value}
                onChange={() => setImplementationFormat(fmt.value)}
                className="mt-0.5 h-4 w-4 border-gray-300 text-[#1B2A4A] focus:ring-[#1B2A4A]"
              />
              <div>
                <span className="text-sm font-medium">{fmt.label}</span>
                <p className="text-xs text-muted-foreground">{fmt.description}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="mt-8 flex gap-3">
        <Button type="button" variant="outline" onClick={onBack} className="flex-1">
          Back
        </Button>
        <Button
          type="button"
          onClick={onNext}
          disabled={!canProceed}
          className="flex-1 bg-[#1B2A4A] hover:bg-[#1B2A4A]"
        >
          Next: Review
        </Button>
      </div>
    </div>
  );
}
