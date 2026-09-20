import { AlertTriangle, CheckCircle2, HelpCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { AttributionChainResult, ChainLink, ChainLinkVerdict, RemedyTier } from '@/types/campaignSignalValidator';

/**
 * Attribution Chain Check PRD §7/§8 — mirrors backend/src/services/
 * attribution/chainCopy.ts + chainModel.ts's REMEDY_TIER_INFO. Kept as a
 * small, duplicated mirror rather than a shared package: the frontend has
 * no mechanism to import backend service code, and this logic is a handful
 * of static strings unlikely to drift silently (both sides derive from the
 * same PRD table, §7).
 *
 * Three distinct visual registers, never conflated (acceptance criterion 4):
 * a not_observed_reason renders as a neutral/informational card (never red),
 * a clean break_at: null result renders as a confirmed-but-partial success
 * (green, with an explicit unverified-links note), and a real break renders
 * as the one thing this product sells — a single named issue with a scoped
 * remedy shape, never a price and never a percentage anywhere.
 */

const CHAIN_LINK_LABELS: Record<ChainLink, string> = {
  arrival: 'Arrival',
  persistence: 'Persistence',
  form_carriage: 'Form carriage',
  crm_arrival: 'CRM arrival',
  real_population: 'Real population',
};

const LINK_ORDER: ChainLink[] = ['arrival', 'persistence', 'form_carriage', 'crm_arrival', 'real_population'];

const REMEDY_TIER_INFO: Record<RemedyTier, { label: string; typical_cause: string; shape_of_work: string }> = {
  1: {
    label: 'Tier 1 — smallest',
    typical_cause: 'Auto-tagging off; a redirect or CDN rule stripping params; consent gate rewriting the URL',
    shape_of_work: 'The best possible first engagement — dramatic effect, minimal effort.',
  },
  2: {
    label: 'Tier 2 — small',
    typical_cause: 'No capture tag deployed',
    shape_of_work: 'Atlas already generates the GTM click-ID capture tag and can deploy it as a draft workspace. Mostly an approval conversation.',
  },
  3: {
    label: 'Tier 3 — variable',
    typical_cause: 'Hidden field absent or not populated at submit',
    shape_of_work: 'Effort depends entirely on the form vendor. Scope after identifying the vendor, never quote blind.',
  },
  4: {
    label: 'Tier 4 — moderate',
    typical_cause: 'No CRM property exists for the value, or the form tool has no field mapping configured for it',
    shape_of_work: 'Predictable. Post-connection finding only.',
  },
  5: {
    label: 'Tier 5 — diagnostic',
    typical_cause: 'Fix applied but never deployed, or applied to one form of several',
    shape_of_work: 'Cheap to find, worth catching — looks like success from both ends.',
  },
};

const LINK_VERDICT_ICON: Record<ChainLinkVerdict, React.ReactNode> = {
  PASS: <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />,
  FAIL: <AlertTriangle className="h-3.5 w-3.5 text-red-600" />,
  NOT_OBSERVED: <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />,
};

export function AttributionChainCard({ chain }: { chain: AttributionChainResult }) {
  if (chain.not_observed_reason) {
    const copy = chain.not_observed_reason === 'no_paid_traffic'
      ? {
        headline: 'Attribution chain: not yet exercised',
        body: 'No paid click parameters were found in this scan’s observed traffic, so the attribution chain could not be exercised. Re-run this check once paid campaigns are live to see a real result.',
      }
      : {
        headline: 'Attribution chain: no lead-gen form reached',
        body: 'This scan found real ad-platform activity but could not reach or submit a lead-gen form on the page, so Links 1 through 3 could not be tested. Confirm a form exists and is reachable, then re-run this check.',
      };
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{copy.headline}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{copy.body}</p>
        </CardContent>
      </Card>
    );
  }

  const isClean = !chain.break_at;
  const remedy = chain.remedy_tier ? REMEDY_TIER_INFO[chain.remedy_tier] : null;

  return (
    <Card className={isClean ? 'border-green-200' : 'border-red-200'}>
      <CardHeader>
        <div className="flex items-center gap-2">
          {isClean ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <AlertTriangle className="h-4 w-4 text-red-600" />}
          <CardTitle className="text-base">
            {isClean ? 'Attribution chain: no break found in Links 1-3' : `Attribution chain breaks at: ${CHAIN_LINK_LABELS[chain.break_at!]}`}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {isClean
            ? 'The click id captured at arrival survived through to the form submission on this scan. This confirms the site-side half of the chain — it does not confirm that the CRM property exists or that live records actually carry the value.'
            : chain.break_evidence}
        </p>

        <div className="flex flex-wrap gap-2">
          {LINK_ORDER.map((link) => (
            <Badge key={link} variant="outline" className="flex items-center gap-1">
              {LINK_VERDICT_ICON[chain.links[link]]}
              {CHAIN_LINK_LABELS[link]}
            </Badge>
          ))}
        </div>

        {remedy && (
          <div className="rounded-lg border bg-muted/40 p-3">
            <p className="text-sm font-semibold">{remedy.label}</p>
            <p className="mt-1 text-sm text-muted-foreground">Typical cause: {remedy.typical_cause}</p>
            <p className="mt-1 text-sm text-muted-foreground">{remedy.shape_of_work}</p>
          </div>
        )}

        {isClean && (
          <p className="text-xs text-muted-foreground">
            CRM arrival and real population (Links 4 and 5) require a connected source and remain unverified from this scan alone.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
