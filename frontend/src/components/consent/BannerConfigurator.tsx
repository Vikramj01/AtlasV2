'use client';

/**
 * BannerConfigurator
 *
 * Form to configure the Atlas consent banner: position, copy, colours, and
 * advanced settings (TTL, logo URL). Calls onSave with the updated BannerConfig.
 */

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import type { BannerConfig, BannerPosition } from '@/types/consent';

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: BannerConfig = {
  position: 'bottom_bar',
  colors: {
    background:       '#ffffff',
    button_primary:   '#000000',
    button_secondary: '#f0f0f0',
    text:             '#000000',
  },
  copy: {
    heading:       'We use cookies',
    body:          'We use cookies to improve your experience and serve personalised content.',
    accept_button: 'Accept All',
    reject_button: 'Reject All',
    manage_link:   'Manage Preferences',
  },
  logo_url: null,
  ttl_days: 365,
};

// ── Position Options ──────────────────────────────────────────────────────────

const POSITIONS: Array<{ value: BannerPosition; label: string; description: string }> = [
  { value: 'bottom_bar', label: 'Bottom Bar',    description: 'Full-width bar anchored to the bottom of the screen' },
  { value: 'modal',      label: 'Centred Modal', description: 'Blocking overlay modal in the centre of the screen' },
  { value: 'corner',     label: 'Corner Widget', description: 'Small floating card in the bottom-right corner' },
];

// ── Props ─────────────────────────────────────────────────────────────────────

interface BannerConfiguratorProps {
  config: BannerConfig | null;
  onSave: (config: BannerConfig) => void;
  saving?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BannerConfigurator({ config, onSave, saving = false }: BannerConfiguratorProps) {
  const [form, setForm] = useState<BannerConfig>(config ?? DEFAULT_CONFIG);

  // Re-initialise if config prop changes (e.g. loaded from API)
  useEffect(() => {
    if (config) setForm(config);
  }, [config]);

  function setPosition(position: BannerPosition) {
    setForm((prev) => ({ ...prev, position }));
  }

  function setCopy(field: keyof BannerConfig['copy'], value: string) {
    setForm((prev) => ({ ...prev, copy: { ...prev.copy, [field]: value } }));
  }

  function setColor(field: keyof BannerConfig['colors'], value: string) {
    setForm((prev) => ({ ...prev, colors: { ...prev.colors, [field]: value } }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave(form);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* ── Position ──────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Position</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {POSITIONS.map(({ value, label, description }) => {
              const selected = form.position === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPosition(value)}
                  className={`text-left rounded-lg border-2 p-4 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                    selected
                      ? 'border-foreground bg-muted'
                      : 'border-border hover:border-muted-foreground'
                  }`}
                >
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-xs text-muted-foreground mt-1">{description}</p>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ── Copy ──────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Copy</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {(
            [
              ['heading',       'Heading',        'text'],
              ['body',          'Body text',       'textarea'],
              ['accept_button', 'Accept button',   'text'],
              ['reject_button', 'Reject button',   'text'],
              ['manage_link',   'Manage link',     'text'],
            ] as [keyof BannerConfig['copy'], string, 'text' | 'textarea'][]
          ).map(([field, label, inputType]) => (
            <div key={field}>
              <label className="block text-sm font-medium mb-1">{label}</label>
              {inputType === 'textarea' ? (
                <textarea
                  rows={3}
                  value={form.copy[field]}
                  onChange={(e) => setCopy(field, e.target.value)}
                  className="w-full border rounded px-3 py-2 text-sm bg-background resize-none focus:outline-none focus:ring-1 focus:ring-foreground"
                />
              ) : (
                <input
                  type="text"
                  value={form.copy[field]}
                  onChange={(e) => setCopy(field, e.target.value)}
                  className="w-full border rounded px-3 py-2 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-foreground"
                />
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ── Colours ───────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Colours</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {(
            [
              ['background',       'Background'],
              ['button_primary',   'Primary button'],
              ['button_secondary', 'Secondary button'],
              ['text',             'Text'],
            ] as [keyof BannerConfig['colors'], string][]
          ).map(([field, label]) => (
            <div key={field} className="flex items-center gap-3">
              <input
                type="color"
                value={form.colors[field]}
                onChange={(e) => setColor(field, e.target.value)}
                className="h-9 w-9 rounded border cursor-pointer p-0.5 bg-background"
              />
              <span className="text-sm font-medium flex-1">{label}</span>
              <code className="text-xs text-muted-foreground">{form.colors[field]}</code>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ── Advanced ──────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Advanced</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              Consent duration (days)
            </label>
            <input
              type="number"
              min={1}
              max={730}
              value={form.ttl_days}
              onChange={(e) => setForm((prev) => ({ ...prev, ttl_days: Number(e.target.value) }))}
              className="w-full border rounded px-3 py-2 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-foreground"
            />
            <p className="text-xs text-muted-foreground mt-1">
              How long to store a visitor's consent decision before asking again. Default: 365 days.
            </p>
          </div>

          <Separator />

          <div>
            <label className="block text-sm font-medium mb-1">Logo URL (optional)</label>
            <input
              type="text"
              placeholder="https://example.com/logo.png"
              value={form.logo_url ?? ''}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, logo_url: e.target.value || null }))
              }
              className="w-full border rounded px-3 py-2 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-foreground"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Displayed in the banner header. Leave blank to omit.
            </p>
          </div>
        </CardContent>
      </Card>

      <Button type="submit" disabled={saving}>
        {saving ? 'Saving…' : 'Save banner config'}
      </Button>
    </form>
  );
}
