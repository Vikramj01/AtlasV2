import { AlertTriangle, X } from 'lucide-react';
import { useState } from 'react';

interface ReauthBannerProps {
  expiredCount: number;
}

export function ReauthBanner({ expiredCount }: ReauthBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || expiredCount === 0) return null;

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-6 py-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
        <p className="text-sm text-amber-800">
          {expiredCount === 1
            ? '1 connection needs re-authorisation.'
            : `${expiredCount} connections need re-authorisation.`}{' '}
          Find expired connections below and click <strong>Re-authorise</strong>.
        </p>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="text-amber-600 hover:text-amber-800 shrink-0"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
