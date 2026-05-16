export interface RuleInterpretation {
  title: string;
  business_impact: string;
  recommended_owner: string;
  fix_summary: string;
  estimated_effort: 'low' | 'medium' | 'high';
}

export const RULE_INTERPRETATIONS: Record<string, RuleInterpretation> = {
  CUSTOM_HTML_TAG_DETECTED: {
    title: 'Custom HTML Tag Detected',
    business_impact:
      'Custom HTML tags bypass GTM\'s built-in consent gating and version control, making tags harder to audit and increasing the risk of tracking data leaking without consent.',
    recommended_owner: 'Tag Manager / Analytics Team',
    fix_summary:
      'Replace Custom HTML tags with native GTM tag templates (e.g. Google Ads, GA4, Meta Pixel). If a native template is unavailable, add explicit consent checks inside the Custom HTML.',
    estimated_effort: 'medium',
  },

  CUSTOM_HTML_TAG_BYPASSES_CONSENT: {
    title: 'Custom HTML Tag Bypasses Consent',
    business_impact:
      'Tracking pixels firing without consent gating violate GDPR/CCPA and risk regulatory fines. Ad platforms may also suspend accounts for consent violations.',
    recommended_owner: 'Legal / Privacy + Tag Manager Team',
    fix_summary:
      'Wrap the Custom HTML tag\'s firing trigger inside a Consent Mode v2 check or a custom event that only fires after the user grants consent. Use GTM\'s built-in Consent Settings for the tag where possible.',
    estimated_effort: 'medium',
  },

  CUSTOM_HTML_TAG_HARDCODES_CONVERSION_DATA: {
    title: 'Custom HTML Tag Contains Hardcoded Conversion Data',
    business_impact:
      'Hardcoded IDs or values mean conversion tracking breaks silently when account IDs rotate, currencies change, or revenue values update. Measurement drift goes undetected until quarterly reporting.',
    recommended_owner: 'Tag Manager Team',
    fix_summary:
      'Extract hardcoded values into GTM Variables (Constant, Data Layer, or URL variables) and reference them via {{Variable Name}} syntax in the tag.',
    estimated_effort: 'low',
  },

  HARDCODED_VALUE_IN_TAG_CONFIG: {
    title: 'Hardcoded Conversion Value',
    business_impact:
      'All conversions report an identical revenue value, corrupting ROAS reporting and value-based bidding signals. Smart Bidding will optimise toward phantom revenue.',
    recommended_owner: 'Tag Manager Team',
    fix_summary:
      'Replace the literal value with a Data Layer Variable that receives the actual transaction value at checkout (e.g. {{dlv - ecommerce.value}}).',
    estimated_effort: 'low',
  },

  HARDCODED_CURRENCY_IN_TAG_CONFIG: {
    title: 'Hardcoded Currency Code',
    business_impact:
      'Currency mismatches cause platform-side conversion import errors for multi-currency sites and may skew value-based bidding across markets.',
    recommended_owner: 'Tag Manager Team',
    fix_summary:
      'Replace the literal currency string with a Data Layer Variable (e.g. {{dlv - ecommerce.currency}}). Ensure the data layer push at checkout passes the correct ISO 4217 code.',
    estimated_effort: 'low',
  },

  HARDCODED_TRANSACTION_ID_IN_TAG_CONFIG: {
    title: 'Hardcoded Transaction ID',
    business_impact:
      'A literal transaction ID disables Google Ads deduplication: every conversion event carries the same ID, so the platform deduplicates them all to a single conversion and under-reports sales.',
    recommended_owner: 'Tag Manager Team',
    fix_summary:
      'Replace with a Data Layer Variable containing the actual order/transaction ID (e.g. {{dlv - ecommerce.transaction_id}}). Verify the data layer push fires on every order confirmation page load.',
    estimated_effort: 'low',
  },

  DUPLICATE_TAG_CONFIGURATION: {
    title: 'Duplicate Tag Configuration',
    business_impact:
      'Duplicate conversion tags fire the same event multiple times per user action, inflating conversion counts, distorting ROAS, and causing Smart Bidding to over-invest in already-performing campaigns.',
    recommended_owner: 'Tag Manager Team',
    fix_summary:
      'Remove duplicate tags or consolidate them into a single tag. If deduplication is required (e.g. server-side + client-side), add a unique event_id parameter to both tags so the platform deduplicates server-side.',
    estimated_effort: 'medium',
  },

  CONSENT_SETTINGS_MISSING_ON_MARKETING_TAG: {
    title: 'Consent Settings Missing on Marketing Tag',
    business_impact:
      'Marketing tags without Consent Settings declared cannot participate in Consent Mode v2 signalling. The platform cannot enforce consent-based modelling and you lose enhanced measurement coverage for consenting users.',
    recommended_owner: 'Tag Manager Team',
    fix_summary:
      'Open the tag in GTM and add the required Consent Settings (ad_storage + ad_user_data for ad tags; analytics_storage for GA4). Verify consent initialisation fires before these tags.',
    estimated_effort: 'low',
  },

  CONSENT_TYPE_MISMATCH: {
    title: 'Consent Type Mismatch on Tag',
    business_impact:
      'Incorrect consent type mapping means the tag may fire for users who have not consented to the correct purpose, creating a compliance gap and potentially invalidating conversion data in regulated jurisdictions.',
    recommended_owner: 'Legal / Privacy + Tag Manager Team',
    fix_summary:
      'Update the tag\'s Consent Settings to match the required types: ad_storage + ad_user_data for advertising tags; analytics_storage for analytics tags. Cross-check against your CMP configuration.',
    estimated_effort: 'low',
  },

  DEFAULT_CONSENT_GRANTED_GLOBALLY: {
    title: 'Default Consent Granted Globally',
    business_impact:
      'Granting ad or analytics consent by default before the user interacts with the CMP violates GDPR Consent Mode requirements. This can result in ICO/DPA enforcement action and invalidation of all consent-mode data.',
    recommended_owner: 'Legal / Privacy + Engineering',
    fix_summary:
      'Set all sensitive consent types (ad_storage, ad_user_data, analytics_storage, ad_personalization) to "denied" in the Consent Mode initialisation tag. Update consent to "granted" only after the user explicitly accepts in the CMP.',
    estimated_effort: 'medium',
  },

  FRAGILE_CSS_SELECTOR_TRIGGER: {
    title: 'Fragile CSS Selector Trigger on Conversion Tag',
    business_impact:
      'Conversion tags firing on CSS class or ID selectors break silently whenever the front-end is restyled or redeployed. You may lose days or weeks of conversion data before the issue is detected.',
    recommended_owner: 'Engineering + Tag Manager Team',
    fix_summary:
      'Replace the CSS selector trigger with a data layer event trigger (dataLayer.push({event: \'conversion_event_name\'})). Work with Engineering to fire the event in the application code at the point of conversion.',
    estimated_effort: 'high',
  },

  TAG_FIRING_REGRESSION_VS_BASELINE: {
    title: 'Tag Firing Regression vs Baseline',
    business_impact:
      'One or more tags that fired on your baseline crawl are no longer firing. Conversion tracking may be broken, causing under-reporting, Smart Bidding degradation, and audience signal loss.',
    recommended_owner: 'Tag Manager Team + Engineering',
    fix_summary:
      'Compare the current GTM container against the baseline and identify which tag or trigger changed. Check for broken data layer pushes, removed selectors, or consent configuration changes that might have suppressed firing.',
    estimated_effort: 'high',
  },

  TAG_PAYLOAD_REGRESSION_VS_BASELINE: {
    title: 'Tag Payload Regression vs Baseline',
    business_impact:
      'Tags are firing but sending different or missing parameters compared to the baseline. This degrades audience targeting precision, breaks enhanced conversions matching, and distorts value-based bidding.',
    recommended_owner: 'Tag Manager Team',
    fix_summary:
      'Review recent GTM container changes for variable renames, data layer schema changes, or removed parameters. Restore missing parameters or update the data layer to supply the expected values.',
    estimated_effort: 'medium',
  },

  SELECTOR_NOT_FOUND_ON_LIVE_SITE: {
    title: 'Trigger Selector Not Found on Live Site',
    business_impact:
      'The CSS selector used to trigger a conversion tag no longer exists in the page DOM. The tag will never fire until the selector is restored, causing complete conversion tracking loss for this event.',
    recommended_owner: 'Engineering + Tag Manager Team',
    fix_summary:
      'Either restore the DOM element with the expected selector, update the GTM trigger to match the current selector, or — preferably — switch to a data layer event trigger that is decoupled from the DOM structure.',
    estimated_effort: 'medium',
  },
};
