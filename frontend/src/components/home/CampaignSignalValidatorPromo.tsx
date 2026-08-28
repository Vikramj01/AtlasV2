import { Link } from 'react-router-dom';
import { ShieldCheck, ArrowRight } from 'lucide-react';

/**
 * Slim promo strip pointing to the Campaign Signal Validator (B9). Home's
 * two-card grid (EvaluateSiteCard / NewClientCard) is a deliberate two-option
 * screen — this sits below it rather than becoming a third card, so it
 * doesn't compete with that layout.
 */
export function CampaignSignalValidatorPromo() {
  return (
    <Link
      to="/tools/campaign-signal-validator"
      className="flex items-center justify-between gap-3 rounded-lg border border-console-border bg-console-surface px-5 py-3.5 transition-colors hover:border-console-primary/40"
    >
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-4 w-4 shrink-0 text-console-primary" />
        <p className="text-sm text-console-fg-muted">
          <span className="font-semibold text-console-fg">Campaign Signal Validator</span> — check
          whether a site's primary conversion signal is ready for automated bidding.
        </p>
      </div>
      <ArrowRight className="h-4 w-4 shrink-0 text-console-fg-muted" />
    </Link>
  );
}
