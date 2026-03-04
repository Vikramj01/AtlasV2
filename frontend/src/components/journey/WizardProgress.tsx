interface WizardProgressProps {
  currentStep: 1 | 2 | 3 | 4;
}

const STEPS = [
  { number: 1, label: 'Business Type' },
  { number: 2, label: 'Journey Stages' },
  { number: 3, label: 'Platforms' },
  { number: 4, label: 'Review & Generate' },
];

export function WizardProgress({ currentStep }: WizardProgressProps) {
  return (
    <div className="flex items-center justify-center mb-8">
      {STEPS.map((step, i) => (
        <div key={step.number} className="flex items-center">
          <div className="flex flex-col items-center">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
                step.number < currentStep
                  ? 'bg-green-500 text-white'
                  : step.number === currentStep
                  ? 'bg-brand-600 text-white'
                  : 'bg-gray-200 text-gray-500'
              }`}
            >
              {step.number < currentStep ? '✓' : step.number}
            </div>
            <span className={`mt-1 text-xs ${step.number === currentStep ? 'text-brand-600 font-medium' : 'text-gray-500'}`}>
              {step.label}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div className={`w-16 h-0.5 mx-2 mb-4 ${step.number < currentStep ? 'bg-green-500' : 'bg-gray-200'}`} />
          )}
        </div>
      ))}
    </div>
  );
}
