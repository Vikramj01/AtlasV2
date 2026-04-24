import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { strategyApi } from '@/lib/api/strategyApi';

interface SavedBrief {
  id: string;
  verdict: string | null;
  business_outcome: string | null;
  created_at: string;
}

export function StrategyGateBanner() {
  const navigate = useNavigate();
  const [brief, setBrief] = useState<SavedBrief | null | undefined>(undefined);

  useEffect(() => {
    strategyApi
      .listBriefs()
      .then((res) => setBrief(res.data?.[0] ?? null))
      .catch(() => setBrief(null));
  }, []);

  if (brief === undefined) return null;

  if (brief) {
    const verdictLabel =
      brief.verdict === 'keep'
        ? 'Keep current event'
        : brief.verdict === 'add_proxy'
          ? 'Add proxy event'
          : brief.verdict === 'switch'
            ? 'Switch conversion event'
            : 'Strategy defined';

    return (
      <div className="mb-6 flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-4">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-600" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-green-900">Conversion event locked</p>
          <p className="mt-0.5 text-xs text-green-700 truncate">
            {verdictLabel}{brief.business_outcome ? ` · ${brief.business_outcome}` : ''}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 text-green-700 hover:text-green-900 text-xs"
          onClick={() => navigate('/planning/strategy')}
        >
          Update
        </Button>
      </div>
    );
  }

  return (
    <div className="mb-6 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-4">
      <Lock className="mt-0.5 size-4 shrink-0 text-amber-600" />
      <div className="flex-1">
        <p className="text-sm font-semibold text-amber-900">Lock your conversion event first</p>
        <p className="mt-0.5 text-xs text-amber-700">
          Define your optimisation objective before scanning — this is required to generate your tracking plan.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3 border-amber-300 text-amber-800 hover:bg-amber-100"
          onClick={() => navigate('/planning/strategy')}
        >
          Lock my conversion event →
        </Button>
      </div>
    </div>
  );
}
