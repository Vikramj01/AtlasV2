import type { Platform, ImplementationFormat } from '@/types/journey';
import { PLATFORM_OPTIONS } from '@/types/journey';
import { useJourneyWizardStore } from '@/store/journeyWizardStore';

interface Step3Props {
  onNext: () => void;
  onBack: () => void;
}

const FORMAT_OPTIONS: { value: ImplementationFormat; label: string; description: string }[] = [
  { value: 'gtm', label: 'Google Tag Manager', description: "Most common — we'll generate dataLayer.push() code" },
  { value: 'walkeros', label: 'WalkerOS', description: "Config-as-code — we'll generate a flow.json file" },
  { value: 'both', label: "Both / Not sure", description: "We'll generate both so you can compare" },
];

export function Step3PlatformSelector({ onNext, onBack }: Step3Props) {
  const { platforms, implementationFormat, togglePlatform, setPlatformId, setImplementationFormat, canProceedFromStep } = useJourneyWizardStore();
  const canProceed = canProceedFromStep(3);

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 text-center">
        Where do you send your tracking data?
      </h2>
      <p className="mt-2 text-center text-gray-500 text-sm">
        Select the platforms you use. Platform IDs are optional — Atlas can detect them.
      </p>

      {/* Platform checkboxes */}
      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {PLATFORM_OPTIONS.map((option) => {
          const selection = platforms.find((p) => p.platform === option.value)!;
          return (
            <div
              key={option.value}
              className={`rounded-xl border-2 p-4 transition-all ${
                selection.isActive ? 'border-brand-500 bg-brand-50' : 'border-gray-200 bg-white'
              }`}
            >
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selection.isActive}
                  onChange={() => togglePlatform(option.value as Platform)}
                  className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                />
                <div>
                  <span className="inline-block rounded bg-gray-100 px-1.5 py-0.5 text-xs font-mono font-semibold text-gray-700 mr-1">
                    {option.logo}
                  </span>
                  <span className="text-sm font-medium text-gray-900">{option.label}</span>
                </div>
              </label>

              {selection.isActive && (
                <div className="mt-3">
                  <input
                    type="text"
                    value={selection.measurementId}
                    onChange={(e) => setPlatformId(option.value as Platform, e.target.value)}
                    placeholder={option.idPlaceholder}
                    className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700 placeholder-gray-400 focus:border-brand-400 focus:outline-none"
                  />
                  <p className="mt-0.5 text-xs text-gray-400">{option.idLabel} (optional)</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!canProceed && (
        <p className="mt-3 text-center text-sm text-red-600">Select at least one platform to continue.</p>
      )}

      {/* Implementation format */}
      <div className="mt-8">
        <h3 className="text-sm font-semibold text-gray-700">How is tracking set up on your site?</h3>
        <div className="mt-3 space-y-2">
          {FORMAT_OPTIONS.map((fmt) => (
            <label key={fmt.value} className="flex items-start gap-3 cursor-pointer rounded-lg border border-gray-200 p-3 hover:border-brand-300 transition-colors">
              <input
                type="radio"
                value={fmt.value}
                checked={implementationFormat === fmt.value}
                onChange={() => setImplementationFormat(fmt.value)}
                className="mt-0.5 h-4 w-4 border-gray-300 text-brand-600 focus:ring-brand-500"
              />
              <div>
                <span className="text-sm font-medium text-gray-900">{fmt.label}</span>
                <p className="text-xs text-gray-500">{fmt.description}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="mt-8 flex gap-3">
        <button type="button" onClick={onBack} className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!canProceed}
          className="flex-1 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40 transition-colors"
        >
          Next: Review
        </button>
      </div>
    </div>
  );
}
