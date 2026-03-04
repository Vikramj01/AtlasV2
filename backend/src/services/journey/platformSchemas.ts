import type { PlatformSchema, Platform } from '../../types/journey';

export const PLATFORM_SCHEMAS: PlatformSchema[] = [
  {
    platform: 'ga4',
    display_name: 'Google Analytics 4',
    detection: {
      script_patterns: ['googletagmanager.com/gtag', 'google-analytics.com/g/collect'],
      network_patterns: ['google-analytics.com/g/collect', 'analytics.google.com'],
      datalayer_markers: ['gtag'],
      global_objects: ['gtag', 'google_tag_manager'],
    },
    delivery: { method: 'script_tag', endpoint_patterns: ['google-analytics.com/g/collect'], required_identifiers: ['measurement_id'] },
    user_data_handling: { supports_enhanced_conversions: true, hashing_required: false, hash_algorithm: 'sha256', hashable_fields: ['user_email', 'user_phone', 'user_address'] },
    click_id: null,
  },
  {
    platform: 'google_ads',
    display_name: 'Google Ads',
    detection: {
      script_patterns: ['googletagmanager.com/gtag', 'googleadservices.com/pagead/conversion'],
      network_patterns: ['googleadservices.com/pagead/conversion', 'google.com/pagead'],
      datalayer_markers: ['google_tag_params'],
      global_objects: ['gtag'],
    },
    delivery: { method: 'script_tag', endpoint_patterns: ['googleadservices.com/pagead/conversion'], required_identifiers: ['conversion_id', 'conversion_label'] },
    user_data_handling: { supports_enhanced_conversions: true, hashing_required: true, hash_algorithm: 'sha256', hashable_fields: ['user_email', 'user_phone'] },
    click_id: { param_name: 'gclid', storage_method: 'cookie', persistence_required: true, cookie_name: '_gcl_aw' },
  },
  {
    platform: 'meta',
    display_name: 'Meta / Facebook',
    detection: {
      script_patterns: ['connect.facebook.net/en_US/fbevents.js'],
      network_patterns: ['facebook.com/tr', 'facebook.com/tr/'],
      datalayer_markers: [],
      global_objects: ['fbq', '_fbq'],
    },
    delivery: { method: 'script_tag', endpoint_patterns: ['facebook.com/tr'], required_identifiers: ['pixel_id'] },
    user_data_handling: { supports_enhanced_conversions: true, hashing_required: true, hash_algorithm: 'sha256', hashable_fields: ['em', 'ph', 'fn', 'ln', 'ct', 'st', 'zp', 'country'] },
    click_id: { param_name: 'fbclid', storage_method: 'cookie', persistence_required: true, cookie_name: '_fbc' },
  },
  {
    platform: 'sgtm',
    display_name: 'Server-side GTM',
    detection: {
      script_patterns: [],
      network_patterns: [],
      datalayer_markers: ['transport_url'],
      global_objects: [],
    },
    delivery: { method: 'server_side', endpoint_patterns: [], required_identifiers: ['transport_url'] },
    user_data_handling: { supports_enhanced_conversions: true, hashing_required: false, hash_algorithm: 'sha256', hashable_fields: ['user_email', 'user_phone'] },
    click_id: null,
  },
  {
    platform: 'tiktok',
    display_name: 'TikTok',
    detection: {
      script_patterns: ['analytics.tiktok.com/i18n/pixel/events.js'],
      network_patterns: ['analytics.tiktok.com/api/v2/pixel'],
      datalayer_markers: [],
      global_objects: ['ttq'],
    },
    delivery: { method: 'script_tag', endpoint_patterns: ['analytics.tiktok.com/api/v2/pixel'], required_identifiers: ['pixel_id'] },
    user_data_handling: { supports_enhanced_conversions: true, hashing_required: true, hash_algorithm: 'sha256', hashable_fields: ['email', 'phone_number'] },
    click_id: { param_name: 'ttclid', storage_method: 'cookie', persistence_required: true, cookie_name: '_ttp' },
  },
  {
    platform: 'linkedin',
    display_name: 'LinkedIn',
    detection: {
      script_patterns: ['snap.licdn.com/li.lms-analytics/insight.min.js'],
      network_patterns: ['px.ads.linkedin.com', 'dc.ads.linkedin.com'],
      datalayer_markers: [],
      global_objects: ['_linkedin_partner_id', 'lintrk'],
    },
    delivery: { method: 'script_tag', endpoint_patterns: ['px.ads.linkedin.com'], required_identifiers: ['partner_id'] },
    user_data_handling: { supports_enhanced_conversions: false, hashing_required: false, hash_algorithm: 'none', hashable_fields: [] },
    click_id: { param_name: 'li_fat_id', storage_method: 'cookie', persistence_required: true, cookie_name: 'li_fat_id' },
  },
];

export function getPlatformSchema(platform: Platform): PlatformSchema | undefined {
  return PLATFORM_SCHEMAS.find((s) => s.platform === platform);
}

export function getActivePlatformSchemas(activePlatforms: Platform[]): PlatformSchema[] {
  return activePlatforms.map((p) => getPlatformSchema(p)).filter((s): s is PlatformSchema => s !== undefined);
}
