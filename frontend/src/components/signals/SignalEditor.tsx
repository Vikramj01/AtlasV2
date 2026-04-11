/**
 * SignalEditor — Modal form for creating or editing a custom signal.
 * When a signal was created from the taxonomy (taxonomy_event_id is set),
 * shows a breadcrumb linking it back to the taxonomy path and a detach option.
 */
import { useState } from 'react';
import { GitBranch, Unlink } from 'lucide-react';
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

  // Taxonomy linkage state — detach clears the FK on save
  const hasTaxonomyLink = !!signal?.taxonomy_event_id;
  const [detachTaxonomy, setDetachTaxonomy] = useState(false);

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
        const updates: Partial<Signal> = {
          name,
          description,
          category,
          required_params: requiredParams,
          optional_params: optionalParams,
        };
        if (detachTaxonomy) {
          updates.taxonomy_event_id = null;
          updates.taxonomy_path = null;
        }
        saved = await signalApi.updateSignal(signal.id, updates);
      } else {
        saved = await signalApi.createSignal({
          organisation_id: orgId,
          key,
          name,
          description,
          category,
          required_params: requiredParams,
          optional_params: optionalParams,
        } as Parameters<typeof signalApi.createSignal>[0]);
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

          {/* Taxonomy breadcrumb (edit only, when linked) */}
          {isEdit && hasTaxonomyLink && !detachTaxonomy && (
            <div className="flex items-center justify-between rounded-lg bg-[#EFF6FF] border border-[#BFDBFE] px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <GitBranch className="h-3.5 w-3.5 text-[#3B82F6] shrink-0" />
                <span className="text-xs text-[#1D4ED8]">Linked to taxonomy</span>
                {signal.taxonomy_path && (
                  <code className="text-[10px] text-[#3B82F6] font-mono truncate">
                    {signal.taxonomy_path}
                  </code>
                )}
              </div>
              <button
                type="button"
                className="flex items-center gap-1 text-[10px] text-[#6B7280] hover:text-red-600 transition-colors shrink-0 ml-2"
                onClick={() => setDetachTaxonomy(true)}
                title="Detach from taxonomy — params will no longer sync"
              >
                <Unlink className="h-3 w-3" />
                Detach
              </button>
            </div>
          )}

          {isEdit && hasTaxonomyLink && detachTaxonomy && (
            <div className="flex items-center justify-between rounded-lg bg-[#FEF2F2] border border-[#FECACA] px-3 py-2">
              <span className="text-xs text-[#DC2626]">Will be detached from taxonomy on save</span>
              <button
                type="button"
                className="text-[10px] text-[#6B7280] hover:text-[#1B2A4A] transition-colors"
                onClick={() => setDetachTaxonomy(false)}
              >
                Undo
              </button>
            </div>
          )}

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
