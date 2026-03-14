/**
 * SignalEditor — Modal form for creating or editing a custom signal.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { signalApi } from '@/lib/api/signalApi';
import type { Signal, SignalCategory, ParamSpec } from '@/types/signal';

interface Props {
  orgId: string;
  signal?: Signal | null;
  onSaved: (signal: Signal) => void;
  onClose: () => void;
}

const CATEGORIES: SignalCategory[] = ['conversion', 'engagement', 'navigation', 'custom'];

function ParamList({
  params,
  onChange,
  label,
}: {
  params: ParamSpec[];
  onChange: (params: ParamSpec[]) => void;
  label: string;
}) {
  function add() {
    onChange([...params, { key: '', label: '', type: 'string' }]);
  }
  function update(idx: number, field: keyof ParamSpec, value: string) {
    onChange(params.map((p, i) => (i === idx ? { ...p, [field]: value } : p)));
  }
  function remove(idx: number) {
    onChange(params.filter((_, i) => i !== idx));
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <Label className="text-xs">{label}</Label>
        <Button type="button" size="sm" variant="ghost" className="h-6 text-xs" onClick={add}>+ Add</Button>
      </div>
      <div className="space-y-1.5">
        {params.map((p, idx) => (
          <div key={idx} className="flex gap-2">
            <Input
              placeholder="key"
              value={p.key}
              onChange={(e) => update(idx, 'key', e.target.value)}
              className="font-mono text-xs h-8 flex-1"
            />
            <Input
              placeholder="Label"
              value={p.label}
              onChange={(e) => update(idx, 'label', e.target.value)}
              className="text-xs h-8 flex-1"
            />
            <select
              value={p.type}
              onChange={(e) => update(idx, 'type', e.target.value)}
              className="rounded-md border bg-background px-2 text-xs h-8"
            >
              <option value="string">string</option>
              <option value="number">number</option>
              <option value="array">array</option>
              <option value="boolean">boolean</option>
            </select>
            <Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-red-600" onClick={() => remove(idx)}>
              ✕
            </Button>
          </div>
        ))}
        {params.length === 0 && (
          <p className="text-xs text-muted-foreground/60 italic">None added.</p>
        )}
      </div>
    </div>
  );
}

export function SignalEditor({ orgId, signal, onSaved, onClose }: Props) {
  const isEdit = !!signal;
  const [key, setKey] = useState(signal?.key ?? '');
  const [name, setName] = useState(signal?.name ?? '');
  const [description, setDescription] = useState(signal?.description ?? '');
  const [category, setCategory] = useState<SignalCategory>(signal?.category ?? 'conversion');
  const [requiredParams, setRequiredParams] = useState<ParamSpec[]>(signal?.required_params ?? []);
  const [optionalParams, setOptionalParams] = useState<ParamSpec[]>(signal?.optional_params ?? []);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!key.trim() || !name.trim() || !description.trim()) {
      setError('key, name, and description are required');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      let saved: Signal;
      if (isEdit && signal) {
        saved = await signalApi.updateSignal(signal.id, { name, description, category, required_params: requiredParams, optional_params: optionalParams });
      } else {
        saved = await signalApi.createSignal({ organisation_id: orgId, key, name, description, category, required_params: requiredParams, optional_params: optionalParams });
      }
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <CardContent className="p-6 space-y-4">
          <h2 className="text-base font-bold">{isEdit ? 'Edit signal' : 'Create custom signal'}</h2>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="sig-key" className="text-xs">Key (snake_case)</Label>
              <Input id="sig-key" placeholder="request_quote" value={key} onChange={(e) => setKey(e.target.value)} disabled={isEdit} className="font-mono text-xs" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sig-name" className="text-xs">Display name</Label>
              <Input id="sig-name" placeholder="Request a Quote" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="sig-desc" className="text-xs">Description</Label>
            <Input id="sig-desc" placeholder="User submits a quote request" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Category</Label>
            <div className="flex gap-2 flex-wrap">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    category === cat ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <ParamList params={requiredParams} onChange={setRequiredParams} label="Required parameters" />
          <ParamList params={optionalParams} onChange={setOptionalParams} label="Optional parameters" />

          {error && <p className="text-xs text-red-600 bg-red-50 rounded px-3 py-2">{error}</p>}

          <div className="flex justify-between pt-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create signal'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
