export interface OnboardingStep {
  id: string;
  phase: 1 | 2;
  status: 'complete' | 'incomplete' | 'skipped';
  required: boolean;
  completed_at: string | null;
  skipped_at: string | null;
}

export interface OnboardingStatus {
  overall_status: 'not_started' | 'in_progress' | 'complete';
  completed_at: string | null;
  dismissed_at: string | null;
  first_client: { id: string; name: string; website_url: string | null } | null;
  steps: Record<string, OnboardingStep>;
  phase_1_complete: boolean;
  phase_2_complete: boolean;
}
