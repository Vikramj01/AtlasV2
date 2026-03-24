'use client';

/**
 * CategoryEditor
 *
 * Editable table for the four fixed consent categories.
 * The `id` field is read-only (displayed as a badge).
 * The `functional` category is always required and locked to default_state: 'granted'.
 * Changes propagate via onChange immediately on each field change.
 */

import type { ConsentCategoryConfig, ConsentState } from '@/types/consent';

interface CategoryEditorProps {
  categories: ConsentCategoryConfig[];
  onChange: (updated: ConsentCategoryConfig[]) => void;
}

const EDITABLE_STATES: ConsentState[] = ['granted', 'denied', 'pending'];

export function CategoryEditor({ categories, onChange }: CategoryEditorProps) {
  function update(index: number, patch: Partial<ConsentCategoryConfig>) {
    const next = categories.map((cat, i) => (i === index ? { ...cat, ...patch } : cat));
    onChange(next);
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-xs text-muted-foreground uppercase tracking-wide">
            <th className="text-left pb-2 font-medium w-32">Category</th>
            <th className="text-left pb-2 font-medium">Name</th>
            <th className="text-left pb-2 font-medium">Description</th>
            <th className="text-center pb-2 font-medium w-20">Required</th>
            <th className="text-left pb-2 font-medium w-36">Default State</th>
          </tr>
        </thead>
        <tbody>
          {categories.map((cat, idx) => {
            const locked = cat.id === 'functional';
            return (
              <tr key={cat.id} className="border-b last:border-0 align-top">
                {/* ID badge — read-only */}
                <td className="py-3 pr-3">
                  <span className="inline-block text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded font-mono">
                    {cat.id}
                  </span>
                </td>

                {/* Name */}
                <td className="py-3 pr-3">
                  <input
                    type="text"
                    value={cat.name}
                    onChange={(e) => update(idx, { name: e.target.value })}
                    className="w-full border rounded px-2 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-foreground"
                  />
                </td>

                {/* Description */}
                <td className="py-3 pr-3">
                  <textarea
                    rows={2}
                    value={cat.description}
                    onChange={(e) => update(idx, { description: e.target.value })}
                    className="w-full border rounded px-2 py-1.5 text-sm bg-background resize-none focus:outline-none focus:ring-1 focus:ring-foreground"
                  />
                </td>

                {/* Required checkbox */}
                <td className="py-3 pr-3 text-center">
                  <input
                    type="checkbox"
                    checked={cat.required}
                    disabled={locked}
                    onChange={(e) => update(idx, { required: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300 disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                </td>

                {/* Default State select */}
                <td className="py-3">
                  {locked ? (
                    <span className="text-xs bg-muted text-muted-foreground px-2 py-1 rounded">
                      granted (locked)
                    </span>
                  ) : (
                    <select
                      value={cat.default_state}
                      onChange={(e) => update(idx, { default_state: e.target.value as ConsentState })}
                      className="w-full border rounded px-2 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-foreground"
                    >
                      {EDITABLE_STATES.map((state) => (
                        <option key={state} value={state}>
                          {state}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
