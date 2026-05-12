import { useEffect, useState } from 'react';
import type { LagClass, JourneyDuration, ProxyEvent } from '@/types/journey';
import { useJourneyWizardStore } from '@/store/journeyWizardStore';
import { getProxyEvents } from '@/lib/api/proxyEventApi';
import { ProxyEventCard } from './ProxyEventCard';

interface ProxyRecommendationListProps {
  lagClass: LagClass;
  parentStageId: string;
  parentDuration: JourneyDuration;
}

export function ProxyRecommendationList({
  lagClass,
  parentStageId,
  parentDuration,
}: ProxyRecommendationListProps) {
  const businessType = useJourneyWizardStore((s) => s.businessType);
  const [proxies, setProxies] = useState<ProxyEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getProxyEvents(lagClass, businessType ?? undefined)
      .then((data) => {
        if (!cancelled) setProxies(data);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load proxy recommendations.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [lagClass, businessType]);

  if (loading) {
    return (
      <div className="space-y-2 animate-pulse">
        <div className="h-3 w-40 rounded bg-black/10" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-14 rounded-md bg-black/5" />
        ))}
      </div>
    );
  }

  if (error) {
    return <p className="text-[11px] text-muted-foreground">{error}</p>;
  }

  if (proxies.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground">
        No proxy events found for this event type.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div>
        <p className="text-xs font-semibold text-foreground">Recommended proxy events</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          These earlier-funnel signals carry optimisation weight while your primary event
          validates quality over time.
        </p>
      </div>
      <div className="space-y-1.5">
        {proxies.map((proxy) => (
          <ProxyEventCard
            key={proxy.id}
            proxy={proxy}
            parentStageId={parentStageId}
            parentDuration={parentDuration}
          />
        ))}
      </div>
    </div>
  );
}
