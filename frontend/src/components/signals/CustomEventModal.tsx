/**
 * CustomEventModal
 *
 * Form for creating a custom taxonomy event under a chosen parent category.
 * Validates the slug against the org's naming convention in real time.
 */
import { useState, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { taxonomyApi } from '@/lib/api/taxonomyApi';
import type { TaxonomyNode, FunnelStage, ValidationResult } from '@/types/taxonomy';

interface ParamRow {
  key: string;
  label: string;
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array';
  description: string;
}

const PARAM_TYPES = ['string', 'number', 'integer', 'boolean', 'array'] as const;
const FUNNEL_STAGES: FunnelStage[] = ['awareness', 'consideration', 'conversion', 'retention', 'advocacy'];

function ParamBuilder({
  label,
  params,
  onChange,
}: {
  label: string;
  params: ParamRow[];
  onChange: (rows: ParamRow[]) => void;
}) {
  function add() {
    onChange([...params, { key: '', label: '', type: 'string', description: '' }]);
  }
  function update(idx: number, field: keyof ParamRow, value: string) {
    onChange(params.map((p, i) => (i === idx ? { ...p, [field]: value } : p)));
  }
  function remove(idx: number) {
    onChange(params.filter((_, i) => i !== idx));
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <Label className="text-xs">{label}</Label>
        <Button type="button" size="sm" variant="ghost" className="h-6 text-xs" onClick={add}>
          + Add
        </Button>
      </div>
      <div className="space-y-1.5">
        {params.map((p, idx) => (
          <div key={idx} className="grid grid-cols-[1fr_1fr_auto_auto] gap-1.5 items-center">
            <Input
              placeholder="key"
              value={p.key}
              onChange={(e) => update(idx, 'key', e.target.value)}
              className="font-mono text-xs h-7"
            />
            <Input
              placeholder="label"
              value={p.label}
              onChange={(e) => update(idx, 'label', e.target.value)}
              className="text-xs h-7"
            />
            <select
              value={p.type}
              onChange={(e) => update(idx, 'type', e.target.value)}
              className="rounded-md border bg-background px-2 text-xs h-7 border-input"
            >
              {PARAM_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground hover:text-red-600"
              onClick={() => remove(idx)}
            >
              <X className="h-3 w-3" />
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

// Collect all category paths from the tree for the parent picker
function collectCategories(nodes: TaxonomyNode[], results: string[] = []): string[] {
  for (const node of nodes) {
    if (node.node_type === 'category') {
      results.push(node.path);
      collectCategories(node.children ?? [], results);
    }
  }
  return results;
}

interface Props {
  orgId: string;
  tree: TaxonomyNode[];
  onCreated: (node: TaxonomyNode) => void;
  onClose: () => void;
}

export function CustomEventModal({ orgId, tree, onCreated, onClose }: Props) {
  const categories = collectCategories(tree);

  const [parentPath, setParentPath] = useState(categories[0] ?? '');
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [funnelStage, setFunnelStage] = useState<FunnelStage | ''>('');
  const [requiredParams, setRequiredParams] = useState<ParamRow[]>([]);
  const [optionalParams, setOptionalParams] = useState<ParamRow[]>([]);

  const [slugValidation, setSlugValidation] = useState<ValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live slug validation (debounced 400ms)
  const validateSlug = useCallback(
    async (value: string) => {
      if (!value.trim()) { setSlugValidation(null); return; }
      setIsValidating(true);
      try {
        const result = await taxonomyApi.validateName(value.trim(), 'event', orgId);
        setSlugValidation(result);
      } catch {
        setSlugValidation(null);
      } finally {
        setIsValidating(false);
      }
    },
    [orgId],
  );

  useEffect(() => {
    const id = setTimeout(() => validateSlug(slug), 400);
    return () => clearTimeout(id);
  }, [slug, validateSlug]);

  async function handleSubmit() {
    if (!slug.trim() || !name.trim() || !parentPath) {
      setError('Parent category, slug, and name are required');
      return;
    }
    if (slugValidation && !slugValidation.valid) {
      setError('Fix slug validation errors before saving');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const node = await taxonomyApi.createEvent({
        organization_id: orgId,
        parent_path: parentPath,
        slug: slug.trim(),
        name: name.trim(),
        description: description.trim() || undefined,
        funnel_stage: funnelStage || undefined,
        parameter_schema: {
          required: requiredParams.map((p) => ({
            key: p.key,
            label: p.label,
            type: p.type,
            description: p.description,
            format: null,
          })),
          optional: optionalParams.map((p) => ({
            key: p.key,
            label: p.label,
            type: p.type,
            description: p.description,
            format: null,
          })),
        },
      });
      onCreated(node);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create event');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <CardContent className="p-6 space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold">Create custom event</h2>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Parent category */}
          <div className="space-y-1">
            <Label className="text-xs">Parent category</Label>
            {categories.length > 0 ? (
              <select
                value={parentPath}
                onChange={(e) => setParentPath(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            ) : (
              <p className="text-xs text-muted-foreground">No categories available — add a category first.</p>
            )}
          </div>

          {/* Slug + Name row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="evt-slug" className="text-xs">Slug (event key)</Label>
              <Input
                id="evt-slug"
                placeholder="add_to_cart"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                className={`font-mono text-xs ${
                  slugValidation
                    ? slugValidation.valid
                      ? 'border-green-400 focus-visible:ring-green-400'
                      : 'border-red-400 focus-visible:ring-red-400'
                    : ''
                }`}
              />
              {isValidating && (
                <p className="text-[10px] text-muted-foreground">Validating…</p>
              )}
              {!isValidating && slugValidation && !slugValidation.valid && (
                <div className="text-[10px] text-red-600 space-y-0.5">
                  {slugValidation.errors.map((e, i) => <p key={i}>{e}</p>)}
                  {slugValidation.suggestions.length > 0 && (
                    <p className="text-[#6B7280]">
                      Suggestion:{' '}
                      <button
                        type="button"
                        className="font-mono underline"
                        onClick={() => setSlug(slugValidation.suggestions[0])}
                      >
                        {slugValidation.suggestions[0]}
                      </button>
                    </p>
                  )}
                </div>
              )}
              {!isValidating && slugValidation?.valid && (
                <p className="text-[10px] text-green-600">Looks good</p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="evt-name" className="text-xs">Display name</Label>
              <Input
                id="evt-name"
                placeholder="Add to Cart"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1">
            <Label htmlFor="evt-desc" className="text-xs">Description <span className="text-muted-foreground">(optional)</span></Label>
            <Input
              id="evt-desc"
              placeholder="User adds a product to their cart"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Funnel stage */}
          <div className="space-y-1">
            <Label className="text-xs">Funnel stage <span className="text-muted-foreground">(optional)</span></Label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  funnelStage === '' ? 'border-[#1B2A4A] bg-[#1B2A4A] text-white' : 'border-[#E5E7EB] text-[#6B7280]'
                }`}
                onClick={() => setFunnelStage('')}
              >
                None
              </button>
              {FUNNEL_STAGES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    funnelStage === s ? 'border-[#1B2A4A] bg-[#1B2A4A] text-white' : 'border-[#E5E7EB] text-[#6B7280]'
                  }`}
                  onClick={() => setFunnelStage(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Parameters */}
          <ParamBuilder
            label="Required parameters"
            params={requiredParams}
            onChange={setRequiredParams}
          />
          <ParamBuilder
            label="Optional parameters"
            params={optionalParams}
            onChange={setOptionalParams}
          />

          {error && (
            <p className="text-xs text-red-600 bg-red-50 rounded px-3 py-2">{error}</p>
          )}

          <div className="flex justify-between pt-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={isSubmitting || (!!slugValidation && !slugValidation.valid)}>
              {isSubmitting ? 'Creating…' : 'Create event'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
