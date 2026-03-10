import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { planningApi } from '@/lib/api/planningApi';
import { usePlanningStore } from '@/store/planningStore';

interface CustomElementFormProps {
  sessionId: string;
  pageId: string;
  onClose: () => void;
}

const ACTION_TYPES = [
  { value: 'click',          label: 'Button / Link Click' },
  { value: 'form_submit',    label: 'Form Submit' },
  { value: 'generate_lead',  label: 'Lead Generation' },
  { value: 'sign_up',        label: 'Sign Up' },
  { value: 'purchase',       label: 'Purchase' },
  { value: 'add_to_cart',    label: 'Add to Cart' },
  { value: 'begin_checkout', label: 'Begin Checkout' },
  { value: 'view_item',      label: 'View Item' },
  { value: 'search',         label: 'Search' },
  { value: 'page_view',      label: 'Page View' },
  { value: 'custom',         label: 'Custom Event' },
];

export function CustomElementForm({ sessionId, pageId, onClose }: CustomElementFormProps) {
  const setRecommendations = usePlanningStore((s) => s.setRecommendations);
  const recommendations = usePlanningStore((s) => s.recommendations);

  const [actionType, setActionType] = useState('click');
  const [eventName, setEventName] = useState('');
  const [selector, setSelector] = useState('');
  const [elementText, setElementText] = useState('');
  const [justification, setJustification] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  function handleActionTypeChange(value: string) {
    setActionType(value);
    if (!eventName) setEventName(value.replace('_', ''));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!eventName.trim()) { setError('Event name is required.'); return; }

    setIsSaving(true);
    setError('');
    try {
      const savedRec = await planningApi.createRecommendation(sessionId, {
        page_id: pageId,
        action_type: actionType,
        event_name: eventName.trim(),
        element_selector: selector || undefined,
        element_text: elementText || undefined,
        business_justification: justification || `Manually added: ${eventName.trim()}`,
        affected_platforms: [],
      });

      setRecommendations([...recommendations, savedRec]);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add element');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-xl bg-background shadow-2xl border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b px-5 py-4">
          <h3 className="text-base font-bold">Add Custom Tracking Element</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Manually specify an element the AI didn't detect.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-5">
          <div className="space-y-1.5">
            <Label>Action type <span className="text-destructive">*</span></Label>
            <Select value={actionType} onValueChange={handleActionTypeChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTION_TYPES.map(({ value, label }) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Event name <span className="text-destructive">*</span></Label>
            <Input
              type="text"
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
              placeholder="e.g. cta_click"
            />
          </div>

          <div className="space-y-1.5">
            <Label>
              CSS selector <span className="text-xs font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              type="text"
              value={selector}
              onChange={(e) => setSelector(e.target.value)}
              placeholder="#submit-btn or .cta-button"
              className="font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <Label>
              Element text <span className="text-xs font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              type="text"
              value={elementText}
              onChange={(e) => setElementText(e.target.value)}
              placeholder="e.g. Get Started Free"
            />
          </div>

          <div className="space-y-1.5">
            <Label>
              Why track this? <span className="text-xs font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              rows={2}
              placeholder="e.g. This CTA drives demo bookings which are our top conversion goal."
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSaving || !eventName.trim()}
              className="bg-brand-600 hover:bg-brand-700"
            >
              {isSaving ? 'Adding…' : 'Add Element'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
