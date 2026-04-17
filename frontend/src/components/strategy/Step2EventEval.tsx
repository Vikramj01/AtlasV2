import { useState } from 'react';
import { AlertTriangle, ChevronLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import type { EventSource, Step2Data } from '@/types/strategy';

const EVENT_SOURCES: { value: EventSource; label: string; description: string }[] = [
  { value: 'pixel', label: 'Client-side pixel', description: 'Tag fires in the browser' },
  { value: 'capi', label: 'Server-side CAPI', description: 'Event sent from your server' },
  { value: 'offline', label: 'Offline upload', description: 'CRM or batch data upload' },
  { value: 'none', label: 'Not currently tracking', description: 'No conversion event set up yet' },
];

interface Step2EventEvalProps {
  onSubmit: (data: Step2Data) => void;
  onBack: () => void;
  loading: boolean;
  error: string | null;
}

export function Step2EventEval({ onSubmit, onBack, loading, error }: Step2EventEvalProps) {
  const [currentEventName, setCurrentEventName] = useState('');
  const [eventSource, setEventSource] = useState<EventSource | null>(null);
  const [valueDataPresent, setValueDataPresent] = useState(false);

  const isValid = currentEventName.trim().length > 0 && eventSource !== null;

  function handleSubmit() {
    if (!isValid || !eventSource) return;
    onSubmit({
      currentEventName: currentEventName.trim(),
      eventSource,
      valueDataPresent,
    });
  }

  function handleRetry() {
    if (isValid && eventSource) {
      onSubmit({ currentEventName: currentEventName.trim(), eventSource, valueDataPresent });
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          What are you currently optimising toward?
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Tell us about the conversion event you send to Meta or Google for campaign optimisation.
        </p>
      </div>

      <div className="space-y-6">
        {/* Current event name */}
        <div className="space-y-2">
          <Label htmlFor="event-name">Current conversion event</Label>
          <Input
            id="event-name"
            value={currentEventName}
            onChange={(e) => setCurrentEventName(e.target.value)}
            placeholder="e.g. Lead, Purchase, SubmitApplication"
          />
        </div>

        {/* Event source */}
        <div className="space-y-2">
          <Label>Event source</Label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {EVENT_SOURCES.map((src) => (
              <button
                key={src.value}
                type="button"
                onClick={() => setEventSource(src.value)}
                className={cn(
                  'flex flex-col items-start rounded-lg border p-3 text-left transition-colors',
                  eventSource === src.value
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'border-border hover:border-primary/50 hover:bg-muted/50',
                )}
              >
                <span className="text-sm font-medium">{src.label}</span>
                <span className="mt-0.5 text-xs text-muted-foreground">{src.description}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Value data toggle */}
        <div className="flex items-center justify-between rounded-lg border border-border p-4">
          <div>
            <p className="text-sm font-medium">Value data passed with event?</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              e.g. order value, lead score, or estimated revenue
            </p>
          </div>
          <Switch
            checked={valueDataPresent}
            onCheckedChange={setValueDataPresent}
            aria-label="Value data present"
          />
        </div>
      </div>

      {/* Error state */}
      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertDescription>
            <p>{error}</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRetry}
              className="mt-2 h-auto p-0 text-xs font-medium underline-offset-2 hover:underline"
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-3">
        <Button onClick={handleSubmit} disabled={!isValid || loading} className="w-full">
          {loading ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Evaluating your event…
            </>
          ) : (
            'Evaluate my event →'
          )}
        </Button>
        <Button
          variant="ghost"
          onClick={onBack}
          disabled={loading}
          className="w-full text-muted-foreground"
        >
          <ChevronLeft className="mr-1 size-4" />
          Back
        </Button>
      </div>
    </div>
  );
}
