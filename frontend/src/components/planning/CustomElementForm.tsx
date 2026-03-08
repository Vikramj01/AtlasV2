import { useState } from 'react';
import { planningApi } from '@/lib/api/planningApi';
import { usePlanningStore } from '@/store/planningStore';
import type { PlanningRecommendation } from '@/types/planning';

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

  // Derive a sensible default event name when action type changes
  function handleActionTypeChange(value: string) {
    setActionType(value);
    if (!eventName) {
      setEventName(value.replace('_', ''));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!eventName.trim()) { setError('Event name is required.'); return; }

    setIsSaving(true);
    setError('');
    try {
      // Record as a pre-approved manual recommendation via the decision endpoint.
      // We first use the generate endpoint pattern — but since there's no dedicated
      // "add custom recommendation" endpoint yet, we create it client-side and
      // immediately record a decision via PATCH.
      //
      // For MVP: create a synthetic recommendation object locally and mark it approved.
      // The backend will treat manually-sourced recs just like AI ones in the generator.
      //
      // A proper implementation would POST to /recommendations to persist first;
      // for now we optimistically add to store and record a decision.
      const syntheticId = `manual-${Date.now()}`;
      const newRec: PlanningRecommendation = {
        id: syntheticId,
        page_id: pageId,
        element_selector: selector || null,
        element_text: elementText || null,
        element_type: null,
        action_type: actionType,
        event_name: eventName.trim(),
        required_params: [],
        optional_params: [],
        bbox_x: null,
        bbox_y: null,
        bbox_width: null,
        bbox_height: null,
        confidence_score: 1,
        business_justification: justification || `Manually added: ${eventName.trim()}`,
        affected_platforms: [],
        user_decision: 'approved',
        modified_config: null,
        decided_at: new Date().toISOString(),
        source: 'manual',
        created_at: new Date().toISOString(),
      };

      setRecommendations([...recommendations, newRec]);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add element');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      {/* Modal */}
      <div
        className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-gray-100 px-5 py-4">
          <h3 className="text-base font-bold text-gray-900">Add Custom Tracking Element</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            Manually specify an element the AI didn't detect.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-5">
          {/* Action type */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              Action type <span className="text-red-500">*</span>
            </label>
            <select
              value={actionType}
              onChange={(e) => handleActionTypeChange(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {ACTION_TYPES.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          {/* Event name */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              Event name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
              placeholder="e.g. cta_click"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          {/* CSS selector (optional) */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              CSS selector{' '}
              <span className="text-xs font-normal text-gray-400">(optional)</span>
            </label>
            <input
              type="text"
              value={selector}
              onChange={(e) => setSelector(e.target.value)}
              placeholder="#submit-btn or .cta-button"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          {/* Element text (optional) */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              Element text{' '}
              <span className="text-xs font-normal text-gray-400">(optional)</span>
            </label>
            <input
              type="text"
              value={elementText}
              onChange={(e) => setElementText(e.target.value)}
              placeholder="e.g. Get Started Free"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          {/* Business justification (optional) */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              Why track this?{' '}
              <span className="text-xs font-normal text-gray-400">(optional)</span>
            </label>
            <textarea
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              rows={2}
              placeholder="e.g. This CTA drives demo bookings which are our top conversion goal."
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving || !eventName.trim()}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {isSaving ? 'Adding…' : 'Add Element'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
