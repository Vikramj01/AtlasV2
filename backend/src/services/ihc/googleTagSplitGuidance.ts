/**
 * Google Tag Topology PRD §7.1 (Sprint 4) — step-by-step split guidance,
 * parameterised with a client's real IDs. Lives in the interpretation layer
 * (not a component) so wording is versioned and testable.
 *
 * Every step carries an evidence level (PRD §1.2): `verified` steps rest on
 * Google's own documentation; `unverified` ones are shown with a qualifier
 * and must never be worded as fact (acceptance criterion 17).
 */
export interface SplitGuidanceStep {
  step: number;
  title: string;
  body: string;
  evidence: 'verified' | 'unverified';
}

export interface SplitGuidanceInput {
  combinedTagIds: string[];
  ga4Id: string | null;
  adsId: string | null;
  secondaryDomains: string[];
}

export const GOOGLE_TAG_SPLIT_GUIDANCE_VERSION = '1.0.0';

export function buildSplitGuidance(input: SplitGuidanceInput): SplitGuidanceStep[] {
  const ids = [input.adsId, input.ga4Id].filter((x): x is string => Boolean(x));
  const idList = ids.length > 0 ? ids.join(' and ') : 'your destination IDs';
  const combined = input.combinedTagIds.length > 0 ? ` (currently combined on ${input.combinedTagIds.join(', ')})` : '';

  return [
    {
      step: 1,
      title: 'Check you can edit the Google tag itself',
      body: `Open Google tag settings (Manage Google tag) for ${idList}${combined}. You may need admin access on the Google tag itself, not only on the Google Analytics property or the Google Ads account.`,
      evidence: 'unverified',
    },
    {
      step: 2,
      title: 'Review the draft Atlas prepared',
      body: 'Atlas adds a separate Google tag for each destination (plus the Conversion Linker when it is needed) as a draft workspace, or as a file you can import. Nothing is published. Review the tags, variables and the one trigger it adds in GTM Preview.',
      evidence: 'verified',
    },
    {
      step: 3,
      title: 'Split the destinations, then publish, in one session',
      body: 'In Google tag settings, open the tag details and use the split icon next to the destination ID to separate it from the combined tag. Then publish the Atlas draft in GTM. Do both in the same session so Google Ads coverage is not left without a Google tag in between. The order that leaves the smaller gap has not been measured; GTM requires a Google tag for each ads product, which is why the draft is added first.',
      evidence: 'verified',
    },
    {
      step: 4,
      title: 'Re-check settings that lived on the combined tag',
      body: `Settings configured on a combined Google tag (cross-domain, internal traffic, consent) belong to whichever tag kept them.${input.secondaryDomains.length > 0 ? ` This client declares secondary domains (${input.secondaryDomains.join(', ')}), so confirm cross-domain measurement still works.` : ''}`,
      evidence: 'verified',
    },
    {
      step: 5,
      title: 'Ask Atlas to verify',
      body: 'After publishing, sync the container and run a scan or confirm the split in Atlas. Atlas marks the plan verified only after it sees the Google tags separated and the Ads Google tag present.',
      evidence: 'verified',
    },
  ];
}
