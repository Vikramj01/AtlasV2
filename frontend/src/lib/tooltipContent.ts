/**
 * Contextual education tooltip content dictionary.
 *
 * Keys map to specific decision points across the product.
 * Content is stored here (not hardcoded in components) so it's easy to update.
 *
 * Each entry has:
 *   title   — short label shown in tooltip header
 *   body    — 1-3 sentence explanation in plain English (for marketers)
 *   stat    — optional eye-catching stat to anchor the impact
 *   learnMore — optional external URL for deeper reading
 */

export interface TooltipContent {
  title: string;
  body: string;
  stat?: string;
  learnMore?: string;
}

const TOOLTIP_CONTENT: Record<string, TooltipContent> = {

  // ── Planning Mode ─────────────────────────────────────────────────────────

  'planning.add_to_cart': {
    title: 'Why track add-to-cart?',
    body: 'Tracking this event lets Google Ads and Meta optimise campaigns for users who show high purchase intent — not just page visitors. Ad platforms use this signal to find more customers who behave like your buyers.',
    stat: 'Advertisers who track add-to-cart events typically see 15–25% better ROAS',
  },

  'planning.purchase': {
    title: 'Why track the purchase event?',
    body: 'The purchase event is the most valuable conversion signal you can send. Every ad platform uses it to attribute revenue, calculate ROAS, and optimise bidding. Without it, automated bidding is flying blind.',
    stat: 'Missing purchase events can inflate your perceived CPA by 2–5×',
  },

  'planning.page_view': {
    title: 'Why track page views?',
    body: 'Page view events build audience pools for remarketing and help ad platforms understand the browsing behaviour that precedes a conversion. They\'re the foundation for funnel analysis.',
  },

  'planning.lead': {
    title: 'Why track form submissions?',
    body: 'For lead generation businesses, form submissions are the primary conversion event. Tracking them lets you optimise for leads, not just traffic — which typically reduces cost-per-lead significantly.',
    stat: 'Lead gen advertisers who track form events see 30–40% lower CPL on average',
  },

  'planning.recommendation_confidence': {
    title: 'What does confidence mean?',
    body: 'Atlas scanned your page and assessed how likely this event is to occur and be measurable. High confidence (≥80%) means Atlas found clear evidence of this activity on your site. Lower confidence means the recommendation is based on your site type, not direct observation.',
  },

  'planning.consent_step': {
    title: 'Why configure consent now?',
    body: 'GDPR and CCPA require explicit user consent before you can fire tracking tags. Without a consent configuration, your generated GTM container will fire on all users — which may expose you to regulatory risk. Setting consent up as part of your tracking plan ensures compliance from day one.',
    stat: 'GDPR non-compliance fines can reach 4% of global annual revenue',
  },

  'planning.gtm_import': {
    title: 'What is a GTM container?',
    body: 'A GTM (Google Tag Manager) container is a pre-built configuration file containing all the tracking tags, variables, and triggers that Atlas recommends for your site. Your developer imports it into your GTM account — no manual tag setup required.',
  },

  // ── CAPI Module ───────────────────────────────────────────────────────────

  'capi.why_server_side': {
    title: 'Why use server-side tracking?',
    body: 'Browser-based tracking (pixels and tags) is blocked by ad blockers and restricted by iOS privacy features. Server-side tracking sends conversion events directly from your server to ad platforms, bypassing these restrictions entirely.',
    stat: 'Server-side tracking typically recovers 40–60% of conversions lost to ad blockers',
  },

  'capi.deduplication': {
    title: 'Why is deduplication important?',
    body: 'When you run both client-side (pixel) and server-side (CAPI) tracking simultaneously, the same conversion event may arrive twice. Event IDs allow ad platforms to deduplicate these and count each conversion only once — preventing inflated reporting.',
  },

  'capi.enhanced_match': {
    title: 'What are enhanced conversions?',
    body: 'Enhanced conversions send hashed customer data (email, phone) alongside conversion events. Ad platforms use this to match conversions back to logged-in users, recovering attribution that would otherwise be lost to cookie blocking.',
    stat: 'Enhanced conversions can improve conversion measurement by 5–15%',
  },

  'capi.emq': {
    title: 'What is Event Match Quality?',
    body: 'Meta\'s Event Match Quality (EMQ) score (0–10) measures how well your conversion events can be matched to Facebook users. Higher scores mean better campaign optimisation. Including email, phone, and browser identifiers (fbp/fbc) boosts your EMQ.',
    stat: 'EMQ above 7.0 is considered strong; below 5.0 indicates significant data gaps',
  },

  'capi.click_id': {
    title: 'What are click IDs?',
    body: 'When someone clicks your ad, Google adds a gclid and Meta adds an fbclid to the landing page URL. Capturing these in first-party cookies and including them in your CAPI events allows ad platforms to precisely attribute conversions back to specific ad clicks — even days later.',
  },

  'capi.fbc_fbp': {
    title: 'What are fbc and fbp?',
    body: 'fbc (Facebook click ID cookie) stores the fbclid from ad clicks. fbp (Facebook browser ID) is a unique identifier for the browser. Including both in your Meta CAPI events significantly improves match rates and conversion attribution.',
  },

  // ── Consent Hub ───────────────────────────────────────────────────────────

  'consent.why_consent': {
    title: 'Why do you need consent management?',
    body: 'Privacy regulations (GDPR, CCPA, ePrivacy) require that users explicitly agree before you track their behaviour. A consent management platform (CMP) collects and records this consent, ensuring your tracking is legally compliant.',
    stat: 'GDPR fines have totalled over €4 billion since 2018',
  },

  'consent.consent_mode': {
    title: 'What is Google Consent Mode v2?',
    body: 'Google Consent Mode v2 tells your GTM tags to behave differently based on whether users have given consent. When consent is denied, tags send cookieless pings instead of full events — preserving some measurement while respecting user choices.',
  },

  'consent.consent_rate': {
    title: 'What is a good consent rate?',
    body: 'Consent rates vary by region and banner design. EU sites typically see 60–75% opt-in rates with well-designed banners. Rates below 50% may indicate banner design issues or overly broad consent requests. A higher consent rate means more usable conversion data.',
  },

  'consent.tcf': {
    title: 'What is the IAB TCF?',
    body: 'The IAB Transparency & Consent Framework (TCF) is a standard used by CMPs to communicate user consent preferences to advertising technology vendors. If you use third-party ad tech beyond just Google and Meta, TCF compliance is important.',
  },

  // ── Developer Portal ──────────────────────────────────────────────────────

  'developer.share_link': {
    title: 'Why share via Atlas\'s portal?',
    body: 'A shared Developer Portal link gives your developer a structured, interactive implementation guide — page by page, event by event, with copyable code snippets and live verification. This cuts implementation time compared to sending a PDF or email.',
    stat: 'Atlas Developer Portal handoffs typically reduce implementation time by ~50%',
  },

  'developer.quick_check': {
    title: 'What is Quick Check?',
    body: 'Quick Check runs a lightweight scan of a single page (takes ~5 seconds) to verify whether a specific tracking event is firing correctly. Developers can use it to validate their implementation page-by-page without running a full audit.',
  },

  'developer.implementation_status': {
    title: 'How does implementation tracking work?',
    body: 'When your developer marks events as implemented in the portal, Atlas records the progress. This updates your Setup Checklist and helps you know when it\'s time to run a full audit to verify everything end-to-end.',
  },

  // ── Audit Mode ────────────────────────────────────────────────────────────

  'audit.signal_health': {
    title: 'What is Signal Health?',
    body: 'Signal Health is the percentage of your 26 conversion tracking rules that are passing. A score of 100% means all your conversion signals are firing correctly, with all required parameters, and persisting correctly across page navigations.',
  },

  'audit.attribution_risk': {
    title: 'What is Attribution Risk?',
    body: 'Attribution Risk measures whether ad platforms can correctly attribute conversions back to specific ad clicks. High risk typically means gclid or fbclid capture is failing, so conversions appear as direct traffic rather than being credited to your ads.',
  },

  // ── Data Health Dashboard ─────────────────────────────────────────────────

  'health.overall_score': {
    title: 'How is the Data Health Score calculated?',
    body: 'Your Data Health Score is a weighted average of four sub-scores: Signal Health (40%), CAPI Delivery Rate (30%), Consent Coverage (20%), and Data Freshness (10%). A score above 80 indicates a strong, reliable tracking setup.',
  },

  'health.capi_delivery': {
    title: 'What is CAPI Delivery Rate?',
    body: 'The percentage of events your Conversion API successfully delivers to ad platforms. A rate below 95% means you\'re losing conversion signals — which reduces the accuracy of automated bidding and conversion attribution.',
  },

  'health.consent_coverage': {
    title: 'What is Consent Coverage?',
    body: 'Consent Coverage shows whether your consent management configuration is active and correctly gating your tracking tags. 100% means Consent Hub is configured and your tags respect user preferences.',
  },
};

export default TOOLTIP_CONTENT;
