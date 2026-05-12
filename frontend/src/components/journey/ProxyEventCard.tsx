import { useState } from 'react';
import type { ProxyEvent, JourneyDuration } from '@/types/journey';
import { TimingBadge } from './TimingBadge';
import { lagClassToDefaultDuration } from '@/lib/journey/classifyEvent';
import { useJourneyWizardStore } from '@/store/journeyWizardStore';

const PLATFORM_LABEL: Record<string, string> = {
  meta: 'Meta',
  google: 'Google',
  both: 'Meta + Google',
};

interface ProxyEventCardProps {
  proxy: ProxyEvent;
  parentStageId: string;
  // The duration already chosen for the parent event — used to position the
  // proxy stage relative to its parent when inserted into the journey.
  parentDuration: JourneyDuration;
}

export function ProxyEventCard({ proxy, parentStageId, parentDuration: _parentDuration }: ProxyEventCardProps) {
  const [added, setAdded] = useState(false);
  const { addProxyStage } = useJourneyWizardStore();

  function handleAdd() {
    if (added) return;
    addProxyStage(
      parentStageId,
      proxy.event_type,
      proxy.name,
      lagClassToDefaultDuration(proxy.lag_class),
    );
    setAdded(true);
  }

  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-[#E5E7EB] bg-white px-3 py-2.5">
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-medium text-foreground">{proxy.name}</span>
          <TimingBadge lagClass={proxy.lag_class} />
          <span className="text-[10px] text-muted-foreground">
            {PLATFORM_LABEL[proxy.platform_benefit] ?? proxy.platform_benefit}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">{proxy.rationale}</p>
      </div>

      <button
        type="button"
        onClick={handleAdd}
        disabled={added}
        className={
          added
            ? 'flex-shrink-0 rounded-md px-2.5 py-1 text-[11px] font-medium bg-green-100 text-green-700 cursor-default'
            : 'flex-shrink-0 rounded-md px-2.5 py-1 text-[11px] font-medium bg-[#1B2A4A] text-white hover:bg-[#1B2A4A]/90 transition-colors'
        }
      >
        {added ? '✓ Added' : 'Add to Journey'}
      </button>
    </div>
  );
}
