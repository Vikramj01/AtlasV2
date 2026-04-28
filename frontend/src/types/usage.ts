export interface UsagePortfolioRow {
  org_id: string;
  org_name: string;
  plan: 'free' | 'pro' | 'agency';
  subscription_tier?: string | null;
  mrr_usd: number;
  scan_cost_usd: number;
  ai_cost_usd: number;
  total_variable_cost_usd: number;
  gross_margin_pct: number | null;
  margin_status: 'green' | 'amber' | 'red' | 'na';
  total_page_scans: number;
  total_ai_calls: number;
  open_violations_count?: number;
  month: string;
}

export interface OrgDailyCost {
  date: string;
  scan_cost_usd: number;
  ai_cost_usd: number;
}

export interface OrgDomainCost {
  domain: string;
  scan_count: number;
  cost_usd: number;
}

export interface OrgAIBreakdown {
  event_type: string;
  call_count: number;
  cost_usd: number;
}

export interface UsageEvent {
  id: string;
  event_type: string;
  cost_usd: number;
  pages_scanned: number | null;
  browser_minutes: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  domain: string | null;
  model: string | null;
  scan_run_id: string | null;
  created_at: string;
}

export interface OrgUsageSummary {
  daily: OrgDailyCost[];
  domains: OrgDomainCost[];
  ai_breakdown: OrgAIBreakdown[];
}
