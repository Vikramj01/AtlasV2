import { useJourneyWizardStore } from '@/store/journeyWizardStore';
import { StageCard } from './StageCard';

interface Step2Props {
  onNext: () => void;
  onBack: () => void;
}

const PAGE_TYPE_OPTIONS = [
  { value: 'product', label: 'Product Page' },
  { value: 'category', label: 'Category Page' },
  { value: 'form', label: 'Form Page' },
  { value: 'search_results', label: 'Search Results' },
  { value: 'landing', label: 'Landing Page' },
  { value: 'confirmation', label: 'Confirmation Page' },
  { value: 'checkout', label: 'Checkout Page' },
  { value: 'custom', label: 'Custom Page' },
];

export function Step2JourneyEditor({ onNext, onBack }: Step2Props) {
  const { stages, addStage, canProceedFromStep } = useJourneyWizardStore();
  const canProceed = canProceedFromStep(2);

  const noUrls = stages.every((s) => !s.sampleUrl);

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 text-center">
        Here's your customer journey — adjust it to match your site
      </h2>
      <p className="mt-2 text-center text-gray-500 text-sm">
        Rename stages, paste your real URLs, and toggle what happens on each page.
      </p>

      {noUrls && stages.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          Without URLs, Atlas can't simulate your site. You'll get a tracking spec but no audit results.
        </div>
      )}

      {stages.length < 2 && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          Add at least 2 stages to continue.
        </div>
      )}

      {/* Stages list */}
      <div className="mt-6 space-y-3">
        {stages.map((stage, i) => (
          <div key={stage.id}>
            <StageCard stage={stage} canRemove={stages.length > 1} />
            {/* Add stage button between stages */}
            <div className="flex justify-center my-1">
              <div className="relative flex items-center w-full">
                <div className="flex-1 border-t border-gray-200" />
                <AddStageButton onAdd={() => addStage(stage.order)} />
                <div className="flex-1 border-t border-gray-200" />
              </div>
            </div>
          </div>
        ))}

        {/* Add stage at end when list is empty */}
        {stages.length === 0 && (
          <AddStageButton onAdd={() => addStage(0)} label="+ Add First Stage" />
        )}
      </div>

      <div className="mt-8 flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!canProceed}
          className="flex-1 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40 transition-colors"
        >
          Next: Select Platforms
        </button>
      </div>
    </div>
  );
}

function AddStageButton({ onAdd, label = '+ Add Stage' }: { onAdd: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onAdd}
      className="mx-2 flex-shrink-0 rounded-full border border-dashed border-gray-300 px-3 py-0.5 text-xs text-gray-500 hover:border-brand-400 hover:text-brand-600 transition-colors"
    >
      {label}
    </button>
  );
}
