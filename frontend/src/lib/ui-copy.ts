export const SECTION_LABELS = {
  signalHealth: {
    primary: 'Ad Data Quality',
    technical: 'Signal Health',
  },
  capi: {
    primary: 'Server-Side Tracking',
    technical: 'Conversions API (CAPI)',
  },
  gtmContainer: {
    primary: 'Tracking Setup',
    technical: 'GTM Container',
  },
  crawlSignalExtractor: {
    primary: 'Website Tracking Scan',
    technical: 'Crawl Signal Extractor',
  },
  emqMonitoring: {
    primary: 'Data Quality Score',
    technical: 'Event Match Quality (EMQ)',
  },
  deduplication: {
    primary: 'Duplicate Prevention',
    technical: 'Deduplication',
  },
  journeyBuilder: {
    primary: 'Tracking Plan Builder',
    technical: 'Journey Builder',
  },
  planningMode: {
    primary: 'Site Scan & Recommendations',
    technical: 'AI Planning Mode',
  },
  conversionStrategyGate: {
    primary: 'Campaign Setup Review',
    technical: 'Conversion Strategy Gate',
  },
  consentHub: {
    primary: 'Cookie & Consent Settings',
    technical: 'Consent Integration Hub',
  },
  offlineConversions: {
    primary: 'CRM / Offline Sales Upload',
    technical: 'Offline Conversions',
  },
  channelInsights: {
    primary: 'Channel Performance Signals',
    technical: 'Channel Insights',
  },
  signalLibrary: {
    primary: 'Tracking Event Templates',
    technical: 'Signal Library',
  },
  readinessScore: {
    primary: 'Platform Readiness',
    technical: 'Readiness Score',
  },
  auditEngine: {
    primary: 'Tracking Audit',
    technical: 'Audit Engine',
  },
} satisfies Record<string, { primary: string; technical: string }>;

export const TOOLTIPS = {
  // Health Dashboard
  healthScore: {
    label: 'Signal Health Score',
    what: 'A measure of how completely your website is sending conversion data to your ad platforms.',
    why: 'A higher score means ad platforms have better data to optimise your budget and target the right people.',
  },
  emq: {
    label: 'Event Match Quality (EMQ)',
    what: "How well the customer data you're sending matches Meta's records.",
    why: 'Higher EMQ directly improves the reach and cost-efficiency of your Meta campaigns.',
  },
  deduplication: {
    label: 'Duplicate Prevention',
    what: 'A process that prevents the same conversion from being counted twice.',
    why: 'Without this, ad platforms over-report results and misallocate your budget.',
  },
  signalFreshness: {
    label: 'Signal Freshness',
    what: 'How recently your tracking signals sent data.',
    why: 'Stale signals can cause ad platforms to optimise on outdated behaviour, increasing your cost-per-result.',
  },
  readinessScore: {
    label: 'Platform Readiness Score',
    what: 'An overall score across all Atlas setup areas.',
    why: 'A complete setup ensures every module is protecting and improving your campaign data.',
  },

  // Crawl Signal Extractor
  crawlRun: {
    label: 'Website Tracking Scan',
    what: 'A scan of your website pages that discovers which tracking signals are active and checks if they are correctly configured.',
    why: 'Gaps found here directly explain why ad platforms may be under-reporting conversions.',
  },
  signalHealthy: {
    label: 'Working Correctly',
    what: 'This tracking signal is firing and sending complete data to your ad platform.',
    why: 'No action needed — this signal is contributing to your campaign performance.',
  },
  signalWarning: {
    label: 'Needs Attention',
    what: 'This signal is firing but is missing data your ad platform needs to optimise spend.',
    why: "Fixing this can improve your campaign's ability to find the right audience.",
  },
  signalError: {
    label: 'Not Working',
    what: 'This signal has stopped sending data to your ad platform.',
    why: 'This is likely reducing the quality of conversion data your campaigns are using.',
  },
  partialCrawl: {
    label: 'Scan Completed with Gaps',
    what: "The scan finished but couldn't reach some pages on your website.",
    why: 'Results shown are based on the pages that were successfully scanned. Re-run the scan or check those URLs manually.',
  },

  // Strategy Gate
  strategyVerdict_CONFIRM: {
    label: 'CONFIRM',
    what: 'Your current tracking event is the right choice for this campaign objective.',
    why: 'No changes needed — proceed to site scan.',
  },
  strategyVerdict_AUGMENT: {
    label: 'AUGMENT',
    what: 'Your current event works but should be supplemented with an additional signal.',
    why: 'Adding the recommended proxy event gives the ad platform more data points to optimise your spend.',
  },
  strategyVerdict_REPLACE: {
    label: 'REPLACE',
    what: "Your current tracking event doesn't match your campaign objective closely enough.",
    why: 'Using the recommended event instead will align what you measure with what you want to achieve.',
  },
  lockBrief: {
    label: 'Lock Strategy Brief',
    what: 'Finalises your conversion strategy so the site scan can begin.',
    why: 'You can always create a new brief later if your strategy changes.',
  },
  proxyEvent: {
    label: 'Proxy Event',
    what: 'A tracking signal that represents an action that happens before the final conversion.',
    why: "Because your conversion timeline is long, ad platforms need an earlier signal to learn from — otherwise they're optimising in the dark.",
  },

  // Journey Builder
  journeyStage: {
    label: 'Journey Stage',
    what: 'A step in your customer journey where a tracking event fires.',
    why: 'Mapping events to journey stages helps ad platforms understand the full path to conversion.',
  },
  gtmContainerExport: {
    label: 'GTM Container Export',
    what: 'A file that can be imported directly into Google Tag Manager.',
    why: 'This saves your developer time by pre-configuring the tracking setup based on your strategy.',
  },

  // Signal Library
  signalPack: {
    label: 'Signal Pack',
    what: 'A curated set of tracking events built for a specific industry or use case.',
    why: 'Signal packs give you a validated starting point instead of configuring events from scratch.',
  },

  // Channel Insights
  channelSignalBehaviour: {
    label: 'Channel Signal Behaviour',
    what: 'How tracking signals are firing across each traffic source (e.g. paid search, organic, email).',
    why: 'Gaps in specific channels can explain underperformance that looks like a media problem but is actually a data problem.',
  },

  // Consent Hub
  consentMode: {
    label: 'Google Consent Mode v2',
    what: 'A framework that tells Google how to handle tracking data based on user consent choices.',
    why: 'Without this configured correctly, you may be losing modelled conversion data in Google Ads.',
  },
  cmpSync: {
    label: 'Consent Platform Sync',
    what: 'Connects Atlas to your existing cookie consent tool (OneTrust, Cookiebot, or Usercentrics).',
    why: 'Ensures your tracking signals only fire in line with what users have agreed to — protecting you from compliance risk.',
  },

  // Offline Conversions
  offlineUpload: {
    label: 'Offline Conversion Upload',
    what: 'A file upload that sends sales or leads from your CRM into Google Ads.',
    why: 'This closes the loop between ad clicks and real-world outcomes, improving Smart Bidding accuracy.',
  },
  gclid: {
    label: 'Click ID (GCLID)',
    what: 'A unique identifier Google Ads assigns to each ad click.',
    why: 'Matching your offline sales back to this ID is how Google Ads knows which clicks converted.',
  },

  // Audit Engine
  auditRun: {
    label: 'Tracking Audit',
    what: 'A simulated visitor journey through your website that checks every tracking event along the way.',
    why: 'Identifies gaps that only appear in real browsing conditions — not just on a single page.',
  },
  gapClassification: {
    label: 'Gap Classification',
    what: 'How a missing or broken tracking event is categorised by where it falls in the customer journey.',
    why: 'Higher-funnel gaps are less critical; lower-funnel gaps (checkout, purchase) directly affect conversion reporting.',
  },
} satisfies Record<string, { label: string; what: string; why: string }>;

export const STATUS_LABELS = {
  healthy: {
    badge: 'Working',
    description: 'This tracking signal is firing and sending complete data to your ad platform.',
  },
  warning: {
    badge: 'Needs Attention',
    description: 'This signal is firing but missing data your ad platform needs to optimise spend.',
  },
  error: {
    badge: 'Not Working',
    description: 'This signal has stopped sending data. This may be affecting your campaign performance.',
  },
} satisfies Record<string, { badge: string; description: string }>;

export const HEALTH_SCORE_CONTEXT = (score: number): string => {
  if (score >= 85) {
    return 'Your ad platforms are receiving strong conversion data. Your campaigns are well-positioned to optimise spend effectively.';
  }
  if (score >= 60) {
    return `Your ad platforms are receiving approximately ${score}% of the conversion data they need. Some signals need attention to improve campaign optimisation.`;
  }
  return `Your tracking score is below 60. Ad platforms are working with incomplete data, which can increase your cost-per-acquisition and reduce targeting accuracy.`;
};

export const EMPTY_STATES = {
  crawlRuns: {
    heading: "You haven't scanned your website yet",
    body: "A scan discovers which tracking signals are live across your pages and checks if they're sending the right data to your ad platforms.",
    cta: 'Start a Website Scan',
  },
  auditHistory: {
    heading: 'No audits run yet',
    body: 'A tracking audit simulates a real visitor journey through your site and checks every conversion event along the way. Run one to find gaps that static checks miss.',
    cta: 'Run a Tracking Audit',
  },
  signalLibrary: {
    heading: 'No tracking events configured',
    body: 'Your signal library holds the tracking events your team has set up. Start by selecting a Signal Pack for your industry, or add events manually.',
    cta: 'Browse Signal Packs',
  },
  journeys: {
    heading: 'No tracking plans created',
    body: 'A tracking plan maps your customer journey to the events your ad platforms need to optimise spend. Create one to generate a ready-to-import GTM setup.',
    cta: 'Build a Tracking Plan',
  },
  strategyBriefs: {
    heading: 'No strategy briefs yet',
    body: 'A strategy brief reviews your campaign objectives and recommends the right conversion events before you run a site scan. This ensures your tracking setup is aligned with your goals.',
    cta: 'Create a Strategy Brief',
  },
  channelInsights: {
    heading: 'No channel data yet',
    body: 'Once your tracking is live, Atlas will show you how signals are behaving across each traffic source — helping you spot data gaps that look like media problems.',
    cta: 'Check Your Signal Setup',
  },
  offlineConversions: {
    heading: 'No offline uploads yet',
    body: 'Upload your CRM or sales data to send offline conversions back to Google Ads. This closes the loop between ad clicks and real-world outcomes.',
    cta: 'Upload Offline Conversions',
  },
  alerts: {
    heading: 'No active alerts',
    body: 'Atlas monitors your tracking signals continuously. If something stops working or degrades, an alert will appear here.',
    cta: null,
  },
} satisfies Record<string, { heading: string; body: string; cta: string | null }>;

export const LOW_HEALTH_CALLOUT = (score: number): string =>
  `Your tracking score has dropped to ${score}. This typically means ad platforms are working with incomplete data, which can increase your cost-per-acquisition and reduce targeting accuracy.`;
