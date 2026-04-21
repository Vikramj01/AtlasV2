export type BusinessType = 'ecommerce' | 'saas' | 'lead_gen' | 'content' | 'marketplace' | 'custom';
export type ClientStatus = 'active' | 'paused' | 'archived';
export type PlatformKey = 'ga4' | 'google_ads' | 'meta' | 'sgtm' | 'tiktok' | 'linkedin';
export type MemberRole = 'owner' | 'admin' | 'member';

export interface Organisation {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  plan: 'pro' | 'agency';
  created_at: string;
  updated_at: string;
  member_count?: number;
  client_count?: number;
}

export interface OrganisationMember {
  id: string;
  organisation_id: string;
  user_id: string;
  role: MemberRole;
  invited_at: string;
  accepted_at: string | null;
  email?: string;
}

export interface Client {
  id: string;
  organisation_id: string;
  name: string;
  website_url: string;
  business_type: BusinessType;
  detected_platform: string | null;
  status: ClientStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClientPlatform {
  id: string;
  client_id: string;
  platform: PlatformKey;
  is_active: boolean;
  measurement_id: string | null;
  config: Record<string, unknown>;
}

export interface ClientPage {
  id: string;
  client_id: string;
  label: string;
  url: string;
  page_type: string;
  stage_order: number;
  created_at: string;
}

export interface ClientWithDetails extends Client {
  platforms: ClientPlatform[];
  pages: ClientPage[];
  signal_health?: number | null;
  last_audit_at?: string | null;
  deployment_count?: number;
}

export interface ClientDeployment {
  id: string;
  client_id: string;
  pack_id: string;
  deployed_at: string;
  last_generated_at: string | null;
  pack?: {
    id: string;
    name: string;
    business_type: string;
    version: number;
  };
}

export interface ClientOutput {
  id: string;
  client_id: string;
  output_type: 'gtm_container' | 'datalayer_spec' | 'implementation_guide';
  output_data: Record<string, unknown> | null;
  version: number;
  generated_at: string;
}
