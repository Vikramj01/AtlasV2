/**
 * GCLID Capture Panel
 *
 * Persistent help section explaining why GCLID matters and how to capture
 * it via a data layer snippet. Always visible on the Offline Conversions tab.
 *
 * Provides:
 *   - Context on why GCLID gives ~90% match rate vs 30–50% email-only
 *   - Step-by-step capture instructions
 *   - Copy-paste JavaScript snippet for the data layer
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const GCLID_SNIPPET = `// Add to your landing page <head> — captures GCLID and stores it in sessionStorage
(function () {
  const params = new URLSearchParams(window.location.search);
  const gclid = params.get('gclid');
  if (gclid) {
    sessionStorage.setItem('gclid', gclid);
    // Optional: also store in a cookie for server-side access
    document.cookie = 'gclid=' + gclid + '; path=/; max-age=2592000; SameSite=Lax';
  }
})();`;

const CRM_INSTRUCTIONS = [
  { step: 1, text: 'Add the snippet above to every landing page (before the </head> tag).' },
  { step: 2, text: 'On form submission, read the GCLID: sessionStorage.getItem(\'gclid\')' },
  { step: 3, text: 'Pass the GCLID value into your CRM as a custom field (e.g. "Google Click ID").' },
  { step: 4, text: 'When exporting closed deals, include the GCLID column in your CSV export.' },
];

export function GCLIDCapturePanel() {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(GCLID_SNIPPET).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <Card className="border-amber-200 bg-amber-50/40">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <span className="text-amber-600 text-base mt-0.5">⚡</span>
            <div>
              <CardTitle className="text-sm font-semibold text-amber-900">
                Improve match rates with GCLID capture
              </CardTitle>
              <p className="text-xs text-amber-700 mt-0.5">
                GCLID matching achieves ~90% match rate. Email-only matching achieves ~30–50%.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="shrink-0 text-xs font-medium text-amber-700 hover:text-amber-900 focus:outline-none"
          >
            {expanded ? 'Hide' : 'How to set this up'}
          </button>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0 space-y-4">
          {/* Steps */}
          <div className="space-y-2">
            {CRM_INSTRUCTIONS.map(({ step, text }) => (
              <div key={step} className="flex gap-3 text-sm">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-200 text-amber-800 text-xs font-semibold">
                  {step}
                </span>
                <span className="text-amber-900">{text}</span>
              </div>
            ))}
          </div>

          {/* Code snippet */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-amber-900">JavaScript snippet (copy into your site)</p>
              <button
                type="button"
                onClick={handleCopy}
                className="text-xs font-medium text-amber-700 hover:text-amber-900 focus:outline-none"
              >
                {copied ? 'Copied ✓' : 'Copy'}
              </button>
            </div>
            <pre className="overflow-x-auto rounded-md bg-amber-100 border border-amber-200 px-3 py-3 text-xs text-amber-900 leading-relaxed font-mono whitespace-pre">
              {GCLID_SNIPPET}
            </pre>
          </div>

          <p className="text-xs text-amber-700">
            Already using Atlas tracking tags? The Setup Tracking wizard includes a GCLID capture
            tag — check your existing GTM container before adding this manually.
          </p>
        </CardContent>
      )}
    </Card>
  );
}
