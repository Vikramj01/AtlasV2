import { useState } from 'react';
import { cn } from '@/lib/utils';
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
        className="text-xs text-[#1B2A4A] hover:text-[#1B2A4A]/80 flex items-center gap-1"
      >
        <span>{open ? '▲' : '▼'}</span>
        <span>What happens here?</span>
        {activeCount > 0 && (
          <span className="ml-1 rounded-full bg-[#EEF1F7] px-1.5 py-0.5 text-[#1B2A4A]">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="mt-2 space-y-1.5 rounded-lg border bg-muted/40 p-3">
          {ACTION_TOGGLES.map((toggle) => {
            const isOn = actions.includes(toggle.key);
            return (
              <label key={toggle.key} className="flex items-center gap-2.5 cursor-pointer">
                <button
                  type="button"
                  role="switch"
                  aria-checked={isOn}
                  onClick={() => toggleAction(stageId, toggle.key)}
                  className={cn(
                    'relative h-5 w-9 flex-shrink-0 rounded-full transition-colors',
                    isOn ? 'bg-[#1B2A4A]' : 'bg-[#D1D5DB]'
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
                      isOn ? 'translate-x-4' : 'translate-x-0'
                    )}
                  />
                </button>
                <span className="text-xs text-muted-foreground">{toggle.label}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
