/**
 * ScheduleModal — create a new scheduled audit.
 *
 * Collects: name, website URL, funnel type, url_map (3 key pages),
 * frequency (daily/weekly), day_of_week, hour_utc.
 */

import { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { scheduleApi } from '@/lib/api/scheduleApi';
import type { CreateScheduleInput, ScheduleFrequency } from '@/types/schedule';
import type { FunnelType } from '@/types/audit';

const FUNNEL_LABELS: Record<FunnelType, string> = {
  ecommerce: 'E-commerce',
  saas:      'SaaS / Subscription',
  lead_gen:  'Lead Generation',
};

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: `${String(i).padStart(2, '0')}:00 UTC`,
}));

interface ScheduleModalProps {
  onClose: () => void;
  onCreated: () => void;
}

export function ScheduleModal({ onClose, onCreated }: ScheduleModalProps) {
  const [name, setName]                   = useState('');
  const [websiteUrl, setWebsiteUrl]       = useState('');
  const [funnelType, setFunnelType]       = useState<FunnelType>('ecommerce');
  const [frequency, setFrequency]         = useState<ScheduleFrequency>('weekly');
  const [dayOfWeek, setDayOfWeek]         = useState(1); // Monday
  const [hourUtc, setHourUtc]             = useState(2); // 02:00 UTC
  const [urlMap, setUrlMap]               = useState({ landing: '', product: '', checkout: '' });
  const [saving, setSaving]               = useState(false);
  const [error, setError]                 = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !websiteUrl.trim()) {
      setError('Name and website URL are required');
      return;
    }

    const filteredUrlMap = Object.fromEntries(
      Object.entries(urlMap).filter(([, v]) => v.trim() !== '')
    );

    setSaving(true);
    setError(null);
    try {
      const input: CreateScheduleInput = {
        name: name.trim(),
        website_url: websiteUrl.trim(),
        funnel_type: funnelType,
        frequency,
        day_of_week: frequency === 'weekly' ? dayOfWeek : null,
        hour_utc: hourUtc,
        url_map: filteredUrlMap,
      };
      await scheduleApi.create(input);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create schedule');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg rounded-2xl bg-background shadow-2xl border max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h2 className="text-base font-semibold">New Scheduled Audit</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Atlas will run this audit automatically and alert you if tracking degrades.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">

          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="sched-name">Schedule name</Label>
            <Input
              id="sched-name"
              placeholder="Weekly ecommerce check"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Website URL */}
          <div className="space-y-1.5">
            <Label htmlFor="sched-url">Website URL</Label>
            <Input
              id="sched-url"
              type="url"
              placeholder="https://example.com"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
            />
          </div>

          {/* Funnel type */}
          <div className="space-y-1.5">
            <Label>Funnel type</Label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(FUNNEL_LABELS) as FunnelType[]).map((ft) => (
                <button
                  key={ft}
                  type="button"
                  onClick={() => setFunnelType(ft)}
                  className={`rounded-lg border px-3 py-2 text-xs text-center transition-colors ${
                    funnelType === ft
                      ? 'border-primary bg-primary/5 text-primary font-medium'
                      : 'border-border hover:border-primary/40'
                  }`}
                >
                  {FUNNEL_LABELS[ft]}
                </button>
              ))}
            </div>
          </div>

          {/* URL map */}
          <div className="space-y-2">
            <Label>Key page URLs <span className="text-muted-foreground font-normal">(optional but recommended)</span></Label>
            {(['landing', 'product', 'checkout'] as const).map((key) => (
              <Input
                key={key}
                placeholder={`${key.charAt(0).toUpperCase() + key.slice(1)} page URL`}
                value={urlMap[key]}
                onChange={(e) => setUrlMap((m) => ({ ...m, [key]: e.target.value }))}
              />
            ))}
          </div>

          {/* Frequency */}
          <div className="space-y-1.5">
            <Label>Frequency</Label>
            <div className="flex gap-2">
              {(['daily', 'weekly'] as ScheduleFrequency[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFrequency(f)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                    frequency === f
                      ? 'border-primary bg-primary/5 text-primary font-medium'
                      : 'border-border hover:border-primary/40'
                  }`}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Day of week (weekly only) */}
          {frequency === 'weekly' && (
            <div className="space-y-1.5">
              <Label>Day of week</Label>
              <div className="grid grid-cols-7 gap-1">
                {DAY_LABELS.map((day, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setDayOfWeek(i)}
                    className={`rounded-md border py-1.5 text-[11px] font-medium transition-colors ${
                      dayOfWeek === i
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border hover:border-primary/40'
                    }`}
                  >
                    {day.slice(0, 3)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Hour UTC */}
          <div className="space-y-1.5">
            <Label htmlFor="sched-hour">Time (UTC)</Label>
            <select
              id="sched-hour"
              value={hourUtc}
              onChange={(e) => setHourUtc(Number(e.target.value))}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {HOUR_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">
              Audits run at {String(hourUtc).padStart(2, '0')}:00 UTC — that's{' '}
              {new Date(new Date().setUTCHours(hourUtc, 0, 0, 0)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} your time.
            </p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Creating…' : 'Create schedule'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
