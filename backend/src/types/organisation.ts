// ─── Organisation & Client types ──────────────────────────────────────────────

export interface Organisation {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  plan: 'pro' | 'agency';
  created_at: string;
  updated_at: string;
}

export type MemberRole = 'owner' | 'admin' | 'member';

export interface OrganisationMember {
  id: string;
  organisation_id: string;
  user_id: string;
  role: MemberRole;
  invited_at: string;
  accepted_at: string | null;
  // Joined from auth.users when listing
  email?: string;
}

export type BusinessType = 'ecommerce' | 'saas' | 'lead_gen' | 'content' | 'marketplace' | 'custom';
export type ClientStatus = 'active' | 'paused' | 'archived';
export type PlatformKey = 'ga4' | 'google_ads' | 'meta' | 'sgtm' | 'tiktok' | 'linkedin';

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

// ─── Request shapes ────────────────────────────────────────────────────────────

export interface CreateOrgRequest {
  name: string;
  slug: string;
}

export interface UpdateOrgRequest {
  name?: string;
}

export interface CreateClientRequest {
  name: string;
  website_url: string;
  business_type: BusinessType;
  notes?: string;
}

export interface UpdateClientRequest {
  name?: string;
  website_url?: string;
  business_type?: BusinessType;
  notes?: string;
  status?: ClientStatus;
}

export interface UpsertPlatformsRequest {
  platforms: Array<{
    platform: PlatformKey;
    is_active: boolean;
    measurement_id?: string | null;
    config?: Record<string, unknown>;
  }>;
}

export interface UpsertPagesRequest {
  pages: Array<{
    label: string;
    url: string;
    page_type?: string;
    stage_order: number;
  }>;
}

// ─── Enriched response shapes ─────────────────────────────────────────────────

export interface ClientWithDetails extends Client {
  platforms: ClientPlatform[];
  pages: ClientPage[];
  signal_health?: number | null;           // Latest audit score, if any
  last_audit_at?: string | null;
  deployment_count?: number;
}

export interface OrgWithStats extends Organisation {
  member_count: number;
  client_count: number;
  members?: OrganisationMember[];
}
