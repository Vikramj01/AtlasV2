/**
 * SetupWizard — Step 2: Map your events to provider standard events
 * File: frontend/src/components/capi/steps/MapEvents.tsx
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useCAPIStore } from '@/store/capiStore';
import { META_EVENT_SUGGESTIONS, META_STANDARD_EVENTS } from '@/lib/capi/adapters/meta';
import { GOOGLE_EVENT_SUGGESTIONS, GOOGLE_STANDARD_EVENTS } from '@/lib/capi/adapters/google';
import type { EventMapping } from '@/types/capi';

interface MapEventsProps {
  onNext: () => void;
  onBack: () => void;
}

interface MappingRow extends EventMapping {
  key: string;       // stable React key
  isCustom: boolean; // true when "Custom…" is selected in the provider_event dropdown
}

const DEFAULT_ROWS: MappingRow[] = [
  { key: 'default-purchase', atlas_event: 'purchase', provider_event: 'Purchase', isCustom: false },
  { key: 'default-lead',     atlas_event: 'lead',     provider_event: 'Lead',     isCustom: false },
];

let rowCounter = DEFAULT_ROWS.length;

function makeKey(): string {
  rowCounter += 1;
  return `row-${rowCounter}`;
}

function buildInitialRows(existing: EventMapping[], standardEvents: readonly string[]): MappingRow[] {
  if (!existing.length) return DEFAULT_ROWS;
  return existing.map((m, i) => ({
    ...m,
    key: `existing-${i}`,
    isCustom: !(standardEvents as readonly string[]).includes(m.provider_event),
  }));
}

export function MapEvents({ onNext, onBack }: MapEventsProps) {
  const { wizardDraft, setWizardDraft } = useCAPIStore();

  const isGoogle = wizardDraft.provider === 'google';
  const standardEvents: readonly string[] = isGoogle ? GOOGLE_STANDARD_EVENTS : META_STANDARD_EVENTS;
  const eventSuggestions: Record<string, string> = isGoogle ? GOOGLE_EVENT_SUGGESTIONS : META_EVENT_SUGGESTIONS;

  const [rows, setRows] = useState<MappingRow[]>(() =>
    buildInitialRows(wizardDraft.event_mapping, standardEvents),
  );

  const [newAtlas, setNewAtlas] = useState('');
  const [newProvider, setNewProvider] = useState<string>(standardEvents[0]);
  const [newCustomProvider, setNewCustomProvider] = useState('');
  const [newIsCustom, setNewIsCustom] = useState(false);

  const [error, setError] = useState<string | null>(null);

  function updateRow(key: string, patch: Partial<MappingRow>) {
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }

  function addRow() {
    const atlasEvent = newAtlas.trim();
    if (!atlasEvent) return;

    const providerEvent = newIsCustom ? newCustomProvider.trim() : newProvider;
    if (!providerEvent) return;

    setRows((prev) => [
      ...prev,
      {
        key: makeKey(),
        atlas_event: atlasEvent,
        provider_event: providerEvent,
        isCustom: newIsCustom,
      },
    ]);

    setNewAtlas('');
    setNewProvider(standardEvents[0]);
    setNewCustomProvider('');
    setNewIsCustom(false);
  }

  function handleNext() {
    if (rows.length === 0) {
      setError('At least one event mapping is required.');
      return;
    }
    setError(null);

    const mappings: EventMapping[] = rows.map(({ atlas_event, provider_event, custom_params }) => ({
      atlas_event,
      provider_event,
      ...(custom_params ? { custom_params } : {}),
    }));

    setWizardDraft({ event_mapping: mappings });
    onNext();
  }

  const suggestedKeys = Object.keys(eventSuggestions);
  const providerLabel = isGoogle ? 'Google Ads Conversion Type' : 'Meta Standard Event';
  const cardTitle = isGoogle
    ? 'Map your events to Google Ads conversion types'
    : 'Map your events to Meta standard events';
  const cardSubtitle = isGoogle
    ? 'Step 2 of 5 — Tell Atlas which of your events maps to each Google Ads conversion type.'
    : 'Step 2 of 5 — Tell Atlas which of your events maps to each Meta standard event.';

  return (
    <Card>
      <CardHeader>
        <CardTitle>{cardTitle}</CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          {cardSubtitle}
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Mapping table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 pr-4 text-left font-medium text-muted-foreground">
                  Your Event (Atlas)
                </th>
                <th className="py-2 pr-4 text-left font-medium text-muted-foreground">
                  {providerLabel}
                </th>
                <th className="py-2 text-left font-medium text-muted-foreground">Remove</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-b last:border-0">
                  <td className="py-2 pr-4">
                    <input
                      type="text"
                      value={row.atlas_event}
                      onChange={(e) => updateRow(row.key, { atlas_event: e.target.value })}
                      className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </td>
                  <td className="py-2 pr-4">
                    <div className="flex gap-2 items-center">
                      <select
                        value={row.isCustom ? 'Custom…' : row.provider_event}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === 'Custom…') {
                            updateRow(row.key, { isCustom: true, provider_event: '' });
                          } else {
                            updateRow(row.key, { isCustom: false, provider_event: val });
                          }
                        }}
                        className="rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        {standardEvents.map((ev) => (
                          <option key={ev} value={ev}>
                            {ev}
                          </option>
                        ))}
                        <option value="Custom…">Custom…</option>
                      </select>
                      {row.isCustom && (
                        <input
                          type="text"
                          value={row.provider_event}
                          onChange={(e) => updateRow(row.key, { provider_event: e.target.value })}
                          placeholder="CustomEventName"
                          className="rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      )}
                    </div>
                  </td>
                  <td className="py-2">
                    <button
                      type="button"
                      onClick={() => removeRow(row.key)}
                      aria-label="Remove mapping"
                      className="text-muted-foreground hover:text-destructive transition-colors text-base font-bold px-1"
                    >
                      &times;
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        {/* Add new row */}
        <div className="rounded-md border border-dashed border-border p-4 space-y-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Add a mapping
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1 space-y-1">
              <label className="text-xs text-muted-foreground">Your Event (Atlas)</label>
              <input
                type="text"
                value={newAtlas}
                onChange={(e) => setNewAtlas(e.target.value)}
                placeholder={suggestedKeys[0] ?? 'my_event'}
                list="atlas-suggestions"
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <datalist id="atlas-suggestions">
                {suggestedKeys.map((k) => (
                  <option key={k} value={k} />
                ))}
              </datalist>
            </div>

            <div className="flex-1 space-y-1">
              <label className="text-xs text-muted-foreground">{providerLabel}</label>
              <div className="flex gap-2">
                <select
                  value={newIsCustom ? 'Custom…' : newProvider}
                  onChange={(e) => {
                    if (e.target.value === 'Custom…') {
                      setNewIsCustom(true);
                      setNewProvider('Custom…');
                    } else {
                      setNewIsCustom(false);
                      setNewProvider(e.target.value);
                    }
                  }}
                  className="rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {standardEvents.map((ev) => (
                    <option key={ev} value={ev}>
                      {ev}
                    </option>
                  ))}
                  <option value="Custom…">Custom…</option>
                </select>
                {newIsCustom && (
                  <input
                    type="text"
                    value={newCustomProvider}
                    onChange={(e) => setNewCustomProvider(e.target.value)}
                    placeholder="CustomEventName"
                    className="rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                )}
              </div>
            </div>

            <div className="flex items-end">
              <Button type="button" variant="outline" size="sm" onClick={addRow}>
                Add
              </Button>
            </div>
          </div>
        </div>

        <div className="flex justify-between">
          <Button type="button" variant="outline" onClick={onBack}>
            Back
          </Button>
          <Button type="button" onClick={handleNext}>
            Next
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
