export interface TrackingStatusClient {
  id: string;
  name: string;
  website_url: string | null;
  business_type: string | null;
  primary_conversion_objective: string | null;
}

export interface TrackingPreconditions {
  website_url: boolean;
  business_type: boolean;
  platforms_connected: string[];
}

export interface InProgressPlanningSession {
  id: string;
  started_at: string;
  page_count: number;
  approved_count: number;
}

export interface InProgressJourneyDraft {
  id: string;
  saved_at: string;
  current_step: number;
  total_steps: number;
}

export interface InProgressRecentCrawl {
  run_id: string;
  completed_at: string;
  signals_found: number;
  is_baseline: boolean;
}

export interface InProgress {
  planning_session: InProgressPlanningSession | null;
  journey_draft: InProgressJourneyDraft | null;
  recent_crawl: InProgressRecentCrawl | null;
}

export interface DeliverableState {
  last_generated_at: string;
  shareable_url: string | null;
  expires_at: string | null;
}

export interface Deployment {
  signals_count: number;
  stages_count: number;
  last_updated_at: string | null;
  designed_via: 'planning_mode' | 'journey_builder' | 'mixed' | null;
  deliverables: {
    datalayer_spec: DeliverableState | null;
    gtm_container: { last_generated_at: string } | null;
  };
}

export interface Verification {
  latest_crawl_run: {
    run_id: string;
    completed_at: string;
    signals_found: number;
  } | null;
  baseline: {
    set: boolean;
    set_at: string | null;
  };
  ihc: {
    drift_count: number;
    last_checked_at: string | null;
  } | null;
}

export interface TrackingStatus {
  client: TrackingStatusClient;
  preconditions: TrackingPreconditions;
  in_progress: InProgress;
  deployment: Deployment;
  verification: Verification;
}

export interface DataLayerEvent {
  signal_key: string;
  event_name: string;
  trigger: string;
  datalayer_push: Record<string, unknown>;
  parameters: Record<string, { type: string; required: boolean; description: string }>;
  platform_mappings: Record<string, string>;
  notes: string | null;
}

export interface DataLayerSpec {
  version: string;
  generated_at: string;
  client: { name: string; website_url: string | null };
  events: DataLayerEvent[];
}

export interface DeliverablesBuildResult {
  gtm_container: Record<string, unknown>;
  datalayer_spec: DataLayerSpec;
}

export interface ShareLinkResult {
  share_url: string;
  token: string;
  expires_at: string;
}

export interface PublicShareResult {
  deliverable_type: string;
  content: DataLayerSpec;
  client_name: string;
  expires_at: string;
  generated_at: string;
}

export type HubState = 'empty' | 'in_progress' | 'complete';

export function deriveHubState(status: TrackingStatus): HubState {
  if (status.deployment.signals_count > 0) return 'complete';
  const hasInProgress =
    status.in_progress.planning_session !== null ||
    status.in_progress.journey_draft !== null;
  return hasInProgress ? 'in_progress' : 'empty';
}
