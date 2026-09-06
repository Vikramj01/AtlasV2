/**
 * Report Honesty PRD Part A — disclosure, never de-rating. Renders nothing
 * for 'high' confidence (or when the field is absent, e.g. a v1-originated
 * result): absence of this chip is itself the signal, so a high-confidence
 * item next to twelve others never gets a redundant "high confidence" badge.
 */
interface Props {
  confidence: 'high' | 'confirm' | undefined;
}

export function ConfidenceBadge({ confidence }: Props) {
  if (confidence !== 'confirm') return null;

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
      <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
      Needs confirmation
    </span>
  );
}
