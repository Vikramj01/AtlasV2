import { useState } from 'react';
import { ACTION_TOGGLES } from '@/types/journey';
import { useJourneyWizardStore } from '@/store/journeyWizardStore';

interface ActionTogglesProps {
  stageId: string;
  actions: string[];
}

export function ActionToggles({ stageId, actions }: ActionTogglesProps) {
  const [open, setOpen] = useState(false);
  const { toggleAction } = useJourneyWizardStore();

  const activeCount = actions.filter((a) => a !== 'ad_landing').length;

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-1"
      >
        <span>{open ? '▲' : '▼'}</span>
        <span>What happens here?</span>
        {activeCount > 0 && (
          <span className="ml-1 rounded-full bg-brand-100 px-1.5 py-0.5 text-brand-700">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="mt-2 space-y-1.5 rounded-lg border border-gray-100 bg-gray-50 p-3">
          {ACTION_TOGGLES.map((toggle) => {
            const isOn = actions.includes(toggle.key);
            return (
              <label key={toggle.key} className="flex items-center gap-2.5 cursor-pointer">
                <button
                  type="button"
                  role="switch"
                  aria-checked={isOn}
                  onClick={() => toggleAction(stageId, toggle.key)}
                  className={`relative h-5 w-9 flex-shrink-0 rounded-full transition-colors ${
                    isOn ? 'bg-brand-500' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                      isOn ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
                <span className="text-xs text-gray-700">{toggle.label}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
