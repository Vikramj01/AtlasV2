import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, ChevronLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useStrategyStore } from '@/store/strategyStore';
import type { BriefMode, BusinessType } from '@/types/strategy';

const TIMING_OPTIONS: { label: string; value: number }[] = [
  { label: 'Same day', value: 0 },
  { label: '1–3 days', value: 2 },
  { label: '4–7 days', value: 5 },
  { label: '1–4 weeks', value: 14 },
  { label: '1–3 months', value: 45 },
  { label: 'Longer than 3 months', value: 120 },
];

const PLATFORMS = [
  { value: 'meta', label: 'Meta' },
  { value: 'google', label: 'Google Ads' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'other', label: 'Other' },
] as const;

const EXAMPLES = [
  { type: 'SaaS', text: 'Customer pays their second monthly subscription without cancelling.' },
  { type: 'Ecommerce', text: 'Customer makes a second purchase within 60 days.' },
  { type: 'Lead gen', text: 'Lead books a qualified sales call and shows up.' },
  { type: 'Publisher', text: 'Subscriber opens 3+ emails in first 30 days.' },
  { type: 'Wholesale', text: 'Buyer places a first bulk order after quote.' },
];

interface Step1DefineProps {
  briefId: string;
  mode: BriefMode;
  objectiveId: string | null;
  onEvaluated: (objectiveId: string) => void;
  onBack: () => void;
}

export function Step1Define({ briefId, mode, objectiveId, onEvaluated, onBack }: Step1DefineProps) {
  const { activeBrief, createObjective, updateObjective, evaluateObjective } = useStrategyStore();

  const [name, setName] = useState('');
  const [businessType, setBusinessType] = useState<BusinessType | ''>('');
  const [outcome, setOutcome] = useState('');
  const [timingDays, setTimingDays] = useState<number | null>(null);
  const [currentEvent, setCurrentEvent] = useState('');
  const [noEvent, setNoEvent] = useState(false);
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [showExamples, setShowExamples] = useState(false);
  const [outcomeError, setOutcomeError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pre-fill from existing objective
  useEffect(() => {
    if (!objectiveId || !activeBrief) return;
    const obj = activeBrief.objectives.find((o) => o.id === objectiveId);
    if (!obj) return;
    setName(obj.name);
    setOutcome(obj.description ?? '');
    setTimingDays(obj.outcome_timing_days ?? null);
    if (obj.current_event && obj.current_event !== 'None') {
      setCurrentEvent(obj.current_event);
    } else if (obj.current_event === 'None') {
      setNoEvent(true);
    }
    setPlatforms(obj.platforms ?? []);
  }, [objectiveId, activeBrief]);

  function togglePlatform(value: string) {
    setPlatforms((prev) =>
      prev.includes(value) ? prev.filter((p) => p !== value) : [...prev, value],
    );
  }

  const effectiveEvent = noEvent ? 'None' : currentEvent.trim();
  const nameValid = mode === 'single' || (name.trim().length >= 3 && name.trim().length <= 50);
  const outcomeValid = outcome.trim().length >= 30;
  const isValid = nameValid && businessType !== '' && outcomeValid && timingDays !== null && (noEvent || currentEvent.trim().length > 0);

  async function handleSubmit() {
    if (!outcomeValid) { setOutcomeError(true); return; }
    if (!isValid) return;
    setLoading(true);
    setError(null);
    try {
      const objectiveName = mode === 'single'
        ? outcome.trim().slice(0, 80)
        : name.trim();

      let objId: string;
      if (objectiveId) {
        await updateObjective(objectiveId, {
          name: objectiveName,
          description: outcome.trim(),
          platforms,
          current_event: effectiveEvent,
          outcome_timing_days: timingDays!,
        });
        objId = objectiveId;
      } else {
        const { objective } = await createObjective({
          brief_id: briefId,
          name: objectiveName,
          description: outcome.trim(),
          platforms,
          current_event: effectiveEvent,
          outcome_timing_days: timingDays!,
        });
        objId = objective.id;
      }

      await evaluateObjective(objId);
      onEvaluated(objId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Define your objective</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Tell us what success looks like and how you're currently measuring it.
        </p>
      </div>

      <div className="space-y-6">
        {/* Objective name — multiple mode only */}
        {mode === 'multi' && (
          <div className="space-y-2">
            <Label htmlFor="obj-name">Objective name</Label>
            <Input
              id="obj-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. New customer acquisition"
              maxLength={50}
            />
            <p className="text-xs text-muted-foreground">
              A short label to tell this objective apart from others. {name.trim().length}/50
            </p>
          </div>
        )}

        {/* Business type */}
        <div className="space-y-2">
          <Label htmlFor="business-type">Business type</Label>
          <Select value={businessType} onValueChange={(v) => setBusinessType(v as BusinessType)}>
            <SelectTrigger id="business-type">
              <SelectValue placeholder="Select business type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ecommerce">Ecommerce</SelectItem>
              <SelectItem value="lead_gen">Lead generation</SelectItem>
              <SelectItem value="b2b_saas">B2B SaaS</SelectItem>
              <SelectItem value="marketplace">Marketplace</SelectItem>
              <SelectItem value="nonprofit">Nonprofit</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Business outcome */}
        <div className="space-y-2">
          <Label htmlFor="outcome">
            What does a genuinely successful customer look like?
          </Label>
          <p className="text-xs text-muted-foreground">
            Not the event you track — the real business result.
          </p>
          <Textarea
            id="outcome"
            value={outcome}
            onChange={(e) => {
              setOutcome(e.target.value);
              if (outcomeError && e.target.value.trim().length >= 30) setOutcomeError(false);
            }}
            onBlur={() => { if (outcome.length > 0 && !outcomeValid) setOutcomeError(true); }}
            placeholder="e.g. Customer makes a second purchase within 60 days of their first order."
            rows={3}
          />
          {outcomeError && (
            <p className="text-xs text-destructive">
              Please be specific — describe the actual business result (30+ characters).
            </p>
          )}
          <p className="text-xs text-muted-foreground">{outcome.trim().length} / 30 minimum</p>

          {/* Examples accordion */}
          <button
            type="button"
            onClick={() => setShowExamples((v) => !v)}
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            {showExamples ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
            See examples
          </button>
          {showExamples && (
            <div className="rounded-md border border-border bg-muted/40 p-3 space-y-2">
              {EXAMPLES.map((ex) => (
                <div key={ex.type}>
                  <span className="text-xs font-semibold">{ex.type}:</span>{' '}
                  <span className="text-xs text-muted-foreground">{ex.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Outcome timing */}
        <div className="space-y-2">
          <Label htmlFor="timing">Outcome timing</Label>
          <Select
            value={timingDays !== null ? String(timingDays) : ''}
            onValueChange={(v) => setTimingDays(Number(v))}
          >
            <SelectTrigger id="timing">
              <SelectValue placeholder="How long after an ad click does this outcome occur?" />
            </SelectTrigger>
            <SelectContent>
              {TIMING_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={String(opt.value)}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Current conversion event */}
        <div className="space-y-2">
          <Label htmlFor="current-event">
            What event are you optimising your ads toward today?
          </Label>
          <p className="text-xs text-muted-foreground">
            The event name you send to Meta, Google Ads, or your CAPI. Examples: Purchase, Sign Up, Lead.
          </p>
          {!noEvent && (
            <Input
              id="current-event"
              value={currentEvent}
              onChange={(e) => setCurrentEvent(e.target.value)}
              placeholder="e.g. Purchase"
            />
          )}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={noEvent}
              onChange={(e) => {
                setNoEvent(e.target.checked);
                if (e.target.checked) setCurrentEvent('');
              }}
              className="rounded border-border"
            />
            <span className="text-xs text-muted-foreground">Not sure / Nothing yet</span>
          </label>
        </div>

        {/* Ad platforms */}
        <div className="space-y-2">
          <Label>Ad platforms</Label>
          <p className="text-xs text-muted-foreground">
            Which platforms are you spending on for this objective? Select all that apply.
          </p>
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => togglePlatform(p.value)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  platforms.includes(p.value)
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border hover:border-primary/50 hover:bg-muted/50',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-3">
        <Button onClick={handleSubmit} disabled={!isValid || loading} className="w-full">
          {loading ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Evaluating your conversion strategy…
            </>
          ) : (
            'Evaluate my conversion strategy →'
          )}
        </Button>
        <Button variant="ghost" onClick={onBack} disabled={loading} className="w-full text-muted-foreground">
          <ChevronLeft className="mr-1 size-4" />
          Back
        </Button>
      </div>
    </div>
  );
}
