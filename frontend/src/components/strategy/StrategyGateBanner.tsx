import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lightbulb, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function StrategyGateBanner() {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem('strategy_gate_dismissed') === 'true',
  );

  if (dismissed) return null;

  function handleDismiss() {
    localStorage.setItem('strategy_gate_dismissed', 'true');
    setDismissed(true);
  }

  return (
    <div className="mb-6 flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-4">
      <Lightbulb className="mt-0.5 size-4 shrink-0 text-blue-500" />
      <div className="flex-1">
        <p className="text-sm font-semibold text-blue-900">
          Before you scan — is your conversion event the right one?
        </p>
        <p className="mt-0.5 text-xs text-blue-700">
          Define your optimisation objective first to get more strategic recommendations from your
          planning session.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3 border-blue-300 text-blue-800 hover:bg-blue-100"
          onClick={() => navigate('/planning/strategy')}
        >
          Define my objective →
        </Button>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="size-6 shrink-0 text-blue-400 hover:text-blue-600"
        onClick={handleDismiss}
        aria-label="Dismiss strategy banner"
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
