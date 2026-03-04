export type BusinessType = 'ecommerce' | 'saas' | 'lead_gen' | 'content' | 'marketplace' | 'custom';
export type ImplementationFormat = 'gtm' | 'walkeros' | 'both';
export type Platform = 'ga4' | 'google_ads' | 'meta' | 'sgtm' | 'tiktok' | 'linkedin';
export type JourneyStatus = 'draft' | 'active' | 'archived';
export type SpecFormat = 'gtm_datalayer' | 'walkeros_flow' | 'validation_spec';

export interface Journey {
  id: string;
  user_id: string;
  name: string;
  business_type: BusinessType;
  status: JourneyStatus;
  implementation_format: ImplementationFormat;
  created_at: string;
  updated_at: string;
}

export interface JourneyStage {
  id: string;
  journey_id: string;
  stage_order: number;
  label: string;
  page_type: string;
  sample_url: string | null;
  actions: string[];
  created_at: string;
  updated_at: string;
}

export interface JourneyPlatform {
  id: string;
  journey_id: string;
  platform: Platform;
  is_active: boolean;
  measurement_id: string | null;
  config: Record<string, unknown>;
  created_at: string;
}

export interface JourneyWithDetails {
  journey: Journey;
  stages: JourneyStage[];
  platforms: JourneyPlatform[];
}

// Wizard-specific local state (before saving to DB)
export interface WizardStage {
  id: string;          // Client-side UUID
  order: number;
  label: string;
  pageType: string;
  sampleUrl: string;
  actions: string[];
}

export interface WizardPlatformSelection {
  platform: Platform;
  isActive: boolean;
  measurementId: string;
}

export interface WizardState {
  currentStep: 1 | 2 | 3 | 4;
  businessType: BusinessType | null;
  stages: WizardStage[];
  platforms: WizardPlatformSelection[];
  implementationFormat: ImplementationFormat;
}

// Business type definitions for Step 1
export interface BusinessTypeOption {
  value: BusinessType;
  title: string;
  description: string;
  icon: string;
  stageCount: number;
}

export const BUSINESS_TYPE_OPTIONS: BusinessTypeOption[] = [
  { value: 'ecommerce', title: 'Online Store', description: 'You sell products online', icon: '🛍️', stageCount: 6 },
  { value: 'saas', title: 'SaaS / Software', description: 'You sell software or subscriptions', icon: '💻', stageCount: 5 },
  { value: 'lead_gen', title: 'Lead Generation', description: 'You collect leads via forms', icon: '📋', stageCount: 4 },
  { value: 'content', title: 'Content / Media', description: 'You publish content and grow audience', icon: '📰', stageCount: 4 },
  { value: 'marketplace', title: 'Marketplace', description: 'You connect buyers and sellers', icon: '🏪', stageCount: 5 },
  { value: 'custom', title: 'Custom', description: "I'll build my own funnel", icon: '⚙️', stageCount: 0 },
];

// Default stages per business type
export const DEFAULT_STAGES: Record<BusinessType, Omit<WizardStage, 'id'>[]> = {
  ecommerce: [
    { order: 1, label: 'Landing Page', pageType: 'landing', sampleUrl: '', actions: ['ad_landing'] },
    { order: 2, label: 'Category Page', pageType: 'category', sampleUrl: '', actions: ['view_item_list'] },
    { order: 3, label: 'Product Page', pageType: 'product', sampleUrl: '', actions: ['view_item', 'add_to_cart'] },
    { order: 4, label: 'Cart', pageType: 'cart', sampleUrl: '', actions: [] },
    { order: 5, label: 'Checkout', pageType: 'checkout', sampleUrl: '', actions: ['begin_checkout'] },
    { order: 6, label: 'Purchase Confirmation', pageType: 'confirmation', sampleUrl: '', actions: ['purchase'] },
  ],
  saas: [
    { order: 1, label: 'Landing Page', pageType: 'landing', sampleUrl: '', actions: ['ad_landing'] },
    { order: 2, label: 'Features', pageType: 'features', sampleUrl: '', actions: ['view_item'] },
    { order: 3, label: 'Pricing', pageType: 'pricing', sampleUrl: '', actions: ['view_item'] },
    { order: 4, label: 'Sign Up', pageType: 'sign_up', sampleUrl: '', actions: ['sign_up'] },
    { order: 5, label: 'Onboarding Complete', pageType: 'confirmation', sampleUrl: '', actions: ['purchase'] },
  ],
  lead_gen: [
    { order: 1, label: 'Landing Page', pageType: 'landing', sampleUrl: '', actions: ['ad_landing'] },
    { order: 2, label: 'Service Pages', pageType: 'custom', sampleUrl: '', actions: ['view_item'] },
    { order: 3, label: 'Contact Form', pageType: 'form', sampleUrl: '', actions: ['generate_lead'] },
    { order: 4, label: 'Thank You Page', pageType: 'confirmation', sampleUrl: '', actions: [] },
  ],
  content: [
    { order: 1, label: 'Landing Page', pageType: 'landing', sampleUrl: '', actions: ['ad_landing'] },
    { order: 2, label: 'Article Page', pageType: 'article', sampleUrl: '', actions: ['view_item'] },
    { order: 3, label: 'Newsletter Signup', pageType: 'sign_up', sampleUrl: '', actions: ['sign_up'] },
    { order: 4, label: 'Confirmation', pageType: 'confirmation', sampleUrl: '', actions: [] },
  ],
  marketplace: [
    { order: 1, label: 'Landing Page', pageType: 'landing', sampleUrl: '', actions: ['ad_landing'] },
    { order: 2, label: 'Search Results', pageType: 'search_results', sampleUrl: '', actions: ['search', 'view_item_list'] },
    { order: 3, label: 'Listing Page', pageType: 'listing', sampleUrl: '', actions: ['view_item'] },
    { order: 4, label: 'Enquiry / Booking', pageType: 'booking', sampleUrl: '', actions: ['begin_checkout', 'generate_lead'] },
    { order: 5, label: 'Confirmation', pageType: 'confirmation', sampleUrl: '', actions: ['purchase'] },
  ],
  custom: [],
};

// Action toggle definitions
export interface ActionToggle {
  key: string;
  label: string;
  defaultForPageTypes: string[];
}

export const ACTION_TOGGLES: ActionToggle[] = [
  { key: 'purchase', label: 'People buy something here', defaultForPageTypes: ['confirmation'] },
  { key: 'add_to_cart', label: 'People add items to a cart here', defaultForPageTypes: ['product', 'listing'] },
  { key: 'begin_checkout', label: 'People start the checkout process here', defaultForPageTypes: ['checkout'] },
  { key: 'generate_lead', label: 'People fill out a form here', defaultForPageTypes: ['form', 'booking'] },
  { key: 'sign_up', label: 'People sign up or create an account here', defaultForPageTypes: ['sign_up'] },
  { key: 'view_item', label: 'People view a specific product or listing here', defaultForPageTypes: ['product', 'listing', 'features', 'pricing', 'article', 'custom'] },
  { key: 'view_item_list', label: 'People browse a list or category here', defaultForPageTypes: ['category', 'search_results'] },
  { key: 'search', label: 'People search for something here', defaultForPageTypes: ['search_results'] },
  { key: 'ad_landing', label: 'This page is important for ad tracking', defaultForPageTypes: ['landing'] },
];

// Platform display info
export interface PlatformInfo {
  value: Platform;
  label: string;
  logo: string;
  defaultActive: boolean;
  idLabel: string;
  idPlaceholder: string;
}

export const PLATFORM_OPTIONS: PlatformInfo[] = [
  { value: 'ga4', label: 'Google Analytics 4', logo: 'GA4', defaultActive: true, idLabel: 'Measurement ID', idPlaceholder: 'G-XXXXXXX' },
  { value: 'google_ads', label: 'Google Ads', logo: 'GAds', defaultActive: true, idLabel: 'Conversion ID', idPlaceholder: 'AW-XXXXXXX' },
  { value: 'meta', label: 'Meta / Facebook', logo: 'Meta', defaultActive: true, idLabel: 'Pixel ID', idPlaceholder: '1234567890' },
  { value: 'sgtm', label: 'Server-side GTM', logo: 'sGTM', defaultActive: false, idLabel: 'sGTM Endpoint URL', idPlaceholder: 'https://gtm.yourdomain.com' },
  { value: 'tiktok', label: 'TikTok', logo: 'TikTok', defaultActive: false, idLabel: 'Pixel ID', idPlaceholder: 'XXXXXXXXXXXXXXX' },
  { value: 'linkedin', label: 'LinkedIn', logo: 'LI', defaultActive: false, idLabel: 'Partner ID', idPlaceholder: '1234567' },
];
