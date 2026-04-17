export type BusinessType =
  | 'ecommerce'
  | 'lead_gen'
  | 'b2b_saas'
  | 'marketplace'
  | 'nonprofit'
  | 'other';

export type EventSource = 'pixel' | 'capi' | 'offline' | 'none';

export type OutcomeCategory =
  | 'purchase'
  | 'qualified_lead'
  | 'activation_milestone'
  | 'retention_event'
  | 'donation';

export type EventVerdict = 'CONFIRM' | 'AUGMENT' | 'REPLACE';

export type WizardStep = 1 | 2 | 'output';

export interface Step1Data {
  businessType: BusinessType;
  outcomeDescription: string;
  outcomeTimingDays: number;
}

export interface Step2Data {
  currentEventName: string;
  eventSource: EventSource;
  valueDataPresent: boolean;
}

export interface StrategyBrief {
  outcomeCategory: OutcomeCategory;
  eventVerdict: EventVerdict;
  verdictRationale: string;
  recommendedEventName: string | null;
  recommendedEventRationale: string | null;
  proxyEventRequired: boolean;
  proxyEventName: string | null;
  proxyEventRationale: string | null;
  summaryMarkdown: string;
}
