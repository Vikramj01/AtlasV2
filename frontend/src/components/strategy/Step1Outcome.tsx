import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import type { Step1Data, BusinessType } from '@/types/strategy';

const TIMING_OPTIONS: { label: string; value: number }[] = [
  { label: 'Same day', value: 0 },
  { label: '1–3 days', value: 2 },
  { label: '4–7 days', value: 5 },
  { label: '1–4 weeks', value: 14 },
  { label: '1–3 months', value: 45 },
  { label: 'Longer than 3 months', value: 120 },
];

interface Step1OutcomeProps {
  onComplete: (data: Step1Data) => void;
}

export function Step1Outcome({ onComplete }: Step1OutcomeProps) {
  const [businessType, setBusinessType] = useState<BusinessType | ''>('');
  const [outcomeDescription, setOutcomeDescription] = useState('');
  const [outcomeTimingDays, setOutcomeTimingDays] = useState<number | null>(null);
  const [showDescError, setShowDescError] = useState(false);

  const descriptionValid = outcomeDescription.trim().length >= 30;
  const isValid = businessType !== '' && descriptionValid && outcomeTimingDays !== null;

  function handleDescBlur() {
    if (outcomeDescription.length > 0 && !descriptionValid) {
      setShowDescError(true);
    } else {
      setShowDescError(false);
    }
  }

  function handleSubmit() {
    if (!descriptionValid) {
      setShowDescError(true);
      return;
    }
    if (!businessType || outcomeTimingDays === null) return;
    onComplete({ businessType, outcomeDescription: outcomeDescription.trim(), outcomeTimingDays });
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Before we scan — what does success actually look like?
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Atlas optimises your tracking setup around your business outcome. Tell us what a
          genuinely good customer means for this client.
        </p>
      </div>

      <div className="space-y-5">
        {/* Business type */}
        <div className="space-y-2">
          <Label htmlFor="business-type">Business type</Label>
          <Select
            value={businessType}
            onValueChange={(v) => setBusinessType(v as BusinessType)}
          >
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

        {/* Outcome description */}
        <div className="space-y-2">
          <Label htmlFor="outcome-description">Business outcome</Label>
          <Textarea
            id="outcome-description"
            value={outcomeDescription}
            onChange={(e) => {
              setOutcomeDescription(e.target.value);
              if (showDescError && e.target.value.trim().length >= 30) {
                setShowDescError(false);
              }
            }}
            onBlur={handleDescBlur}
            placeholder="Describe what a genuinely successful customer looks like — not the event you track, the actual business result."
            rows={4}
          />
          {showDescError && (
            <p className="text-xs text-destructive">
              Please be specific — describe the actual business outcome, not just a tracked event.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {outcomeDescription.trim().length} / 30 characters minimum
          </p>
        </div>

        {/* Outcome timing */}
        <div className="space-y-2">
          <Label htmlFor="outcome-timing">Outcome timing</Label>
          <Select
            value={outcomeTimingDays !== null ? String(outcomeTimingDays) : ''}
            onValueChange={(v) => setOutcomeTimingDays(Number(v))}
          >
            <SelectTrigger id="outcome-timing">
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
      </div>

      <Button onClick={handleSubmit} disabled={!isValid} className="w-full">
        Continue to event check →
      </Button>
    </div>
  );
}
