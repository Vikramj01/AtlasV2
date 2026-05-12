import { useState } from 'react';
import { cn } from '@/lib/utils';
import { ACTION_TOGGLES, CONVERSION_ACTION_KEYS } from '@/types/journey';
import type { JourneyDuration } from '@/types/journey';
import { useJourneyWizardStore } from '@/store/journeyWizardStore';
import { classifyEvent } from '@/lib/journey/classifyEvent';
import { BusinessModelContextSelector } from './BusinessModelContextSelector';
import { TimingAssessmentPanel } from './TimingAssessmentPanel';

interface ActionTogglesProps {
  stageId: string;
  actions: string[];
}

export function ActionToggles({ stageId, actions }: ActionTogglesProps) {
  const [open, setOpen] = useState(false);
  const { toggleAction, stageTiming, setStageJourneyDuration } = useJourneyWizardStore();

  // Track per-toggle journey duration selections locally — only conversion actions
  // that are currently ON need a duration. We mirror confirmed selections into the
  // store via setStageJourneyDuration when the user picks an option.
  const [localDurations, setLocalDurations] = useState<Record<string, JourneyDuration | null>>({});

  const activeCount = actions.filter((a) => a !== 'ad_landing').length;

  function handleDurationChange(actionKey: string, duration: JourneyDuration) {
    setLocalDurations((prev: Record<string, JourneyDuration | null>) => ({ ...prev, [actionKey]: duration }));
    // Persist to store — keyed by stageId + actionKey so multiple conversion
    // actions on one stage each get their own timing entry.
    setStageJourneyDuration(`${stageId}::${actionKey}`, duration);
  }

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
            const isConversion = CONVERSION_ACTION_KEYS.has(toggle.key);
            const selectedDuration = localDurations[toggle.key] ?? null;
            const timingKey = `${stageId}::${toggle.key}`;
            const timing = stageTiming[timingKey];

            return (
              <div key={toggle.key}>
                <label className="flex items-center gap-2.5 cursor-pointer">
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

                {/* Journey duration selector + timing panel for conversion actions */}
                {isOn && isConversion && (
                  <div className="ml-11">
                    <BusinessModelContextSelector
                      value={selectedDuration}
                      onChange={(d) => handleDurationChange(toggle.key, d)}
                    />

                    {selectedDuration && (
                      <TimingAssessmentPanel
                        eventName={toggle.label}
                        lagClass={classifyEvent(selectedDuration)}
                        // proxySlot wired in Sprint 3
                      />
                    )}

                    {/* Proxy badge if this stage was added as a proxy */}
                    {timing?.is_proxy && (
                      <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                        Proxy signal
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
