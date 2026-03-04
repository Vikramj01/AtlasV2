import type { BusinessType } from '@/types/journey';
import { BUSINESS_TYPE_OPTIONS } from '@/types/journey';
import { useJourneyWizardStore } from '@/store/journeyWizardStore';

interface Step1Props {
  onNext: () => void;
}

export function Step1BusinessType({ onNext }: Step1Props) {
  const { businessType, setBusinessType } = useJourneyWizardStore();

  function handleSelect(type: BusinessType) {
    setBusinessType(type);
    // Auto-advance after a brief visual confirmation
    setTimeout(onNext, 150);
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 text-center">What kind of site do you have?</h2>
      <p className="mt-2 text-center text-gray-500">
        Atlas will pre-load a journey template that matches your funnel.
      </p>

      <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
        {BUSINESS_TYPE_OPTIONS.map((option) => (
          <button
            key={option.value}
            onClick={() => handleSelect(option.value)}
            className={`flex flex-col items-center rounded-xl border-2 p-5 text-left transition-all hover:border-brand-400 hover:shadow-sm ${
              businessType === option.value
                ? 'border-brand-500 bg-brand-50 shadow-sm'
                : 'border-gray-200 bg-white'
            }`}
          >
            <span className="text-3xl mb-3">{option.icon}</span>
            <span className="font-semibold text-gray-900">{option.title}</span>
            <span className="mt-1 text-xs text-gray-500 text-center">{option.description}</span>
            {option.stageCount > 0 && (
              <span className="mt-3 text-xs text-brand-600">
                {option.stageCount} stages pre-loaded
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
