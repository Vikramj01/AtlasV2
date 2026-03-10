import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import type { ReportJSON, PlatformBreakdown, ValidationResult } from '@/types/audit';
import { PLATFORM_LABELS } from '@/utils/languageMap';

const PLATFORM_STATUS_CONFIG = {
  healthy:  { badge: 'bg-green-100 text-green-700 hover:bg-green-100',  label: 'Healthy' },
  at_risk:  { badge: 'bg-yellow-100 text-yellow-700 hover:bg-yellow-100', label: 'At Risk' },
  broken:   { badge: 'bg-red-100 text-red-700 hover:bg-red-100',         label: 'Broken' },
};

const RULE_LABELS: Record<string, { pass: string; fail: string }> = {
  GA4_PURCHASE_EVENT_FIRED:                { pass: 'Purchase event detected',                  fail: 'Purchase event not detected' },
  META_PIXEL_PURCHASE_EVENT_FIRED:         { pass: 'Pixel purchase event detected',             fail: 'Pixel purchase event not detected' },
  GOOGLE_ADS_CONVERSION_EVENT_FIRED:       { pass: 'Conversion event detected',                 fail: 'Conversion event not detected' },
  SGTM_SERVER_EVENT_FIRED:                 { pass: 'Server event detected',                     fail: 'Server event not detected' },
  DATALAYER_POPULATED:                     { pass: 'Data layer populated',                      fail: 'Data layer not populated' },
  GTM_CONTAINER_LOADED:                    { pass: 'GTM container loaded',                      fail: 'GTM container not loaded' },
  PAGE_VIEW_EVENT_FIRED:                   { pass: 'Page view event firing',                    fail: 'Page view event not firing' },
  ADD_TO_CART_EVENT_FIRED:                 { pass: 'Add to cart event firing',                  fail: 'Add to cart event not firing' },
  TRANSACTION_ID_PRESENT:                  { pass: 'Transaction ID present',                    fail: 'Transaction ID missing' },
  VALUE_PARAMETER_PRESENT:                 { pass: 'Value parameter sent',                      fail: 'Value parameter missing' },
  CURRENCY_PARAMETER_PRESENT:              { pass: 'Currency correct',                          fail: 'Currency parameter missing' },
  GCLID_CAPTURED_AT_LANDING:              { pass: 'Google click ID captured',                  fail: 'Google click ID not captured' },
  FBCLID_CAPTURED_AT_LANDING:             { pass: 'Facebook click ID captured',                fail: 'Facebook click ID not captured' },
  EVENT_ID_GENERATED:                      { pass: 'Event deduplication ID generated',          fail: 'Event deduplication ID missing' },
  EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS: { pass: 'Email captured for enhanced matching',      fail: 'Email not captured for enhanced matching' },
  PHONE_CAPTURED_FOR_CAPI:                 { pass: 'Phone captured for server matching',        fail: 'Phone not captured for server matching' },
  ITEMS_ARRAY_POPULATED:                   { pass: 'Products array populated',                  fail: 'Products array empty or missing' },
  USER_ID_PRESENT:                         { pass: 'User ID present',                           fail: 'User ID missing' },
  COUPON_CAPTURED_IF_USED:                 { pass: 'Coupon code captured',                      fail: 'Coupon code not captured' },
  SHIPPING_CAPTURED:                       { pass: 'Shipping value captured',                   fail: 'Shipping value not captured' },
  GCLID_PERSISTS_TO_CONVERSION:            { pass: 'Google click ID persisted to conversion',   fail: 'Google click ID lost before conversion' },
  FBCLID_PERSISTS_TO_CONVERSION:           { pass: 'Facebook click ID persisted to conversion', fail: 'Facebook click ID lost before conversion' },
  TRANSACTION_ID_MATCHES_ORDER_SYSTEM:     { pass: 'Transaction ID verified',                   fail: 'Transaction ID mismatch with order system' },
  EVENT_ID_CONSISTENCY_CLIENT_TO_SERVER:   { pass: 'Event deduplication consistent',            fail: 'Event deduplication mismatch' },
  USER_DATA_NORMALIZED_CONSISTENTLY:       { pass: 'User data formatted consistently',          fail: 'User data formatting inconsistent' },
  PII_PROPERLY_HASHED:                     { pass: 'Email properly hashed',                     fail: 'Email not properly hashed' },
};

interface PlatformCardProps {
  platform: PlatformBreakdown;
  validationResults: ValidationResult[];
}

function PlatformCard({ platform, validationResults }: PlatformCardProps) {
  const cfg = PLATFORM_STATUS_CONFIG[platform.status];
  const label = PLATFORM_LABELS[platform.platform] ?? platform.platform;

  const platformRuleMap: Record<string, string[]> = {
    google_ads: [
      'GOOGLE_ADS_CONVERSION_EVENT_FIRED', 'GCLID_CAPTURED_AT_LANDING',
      'VALUE_PARAMETER_PRESENT', 'CURRENCY_PARAMETER_PRESENT',
      'GCLID_PERSISTS_TO_CONVERSION', 'EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS',
    ],
    meta_ads: [
      'META_PIXEL_PURCHASE_EVENT_FIRED', 'FBCLID_CAPTURED_AT_LANDING',
      'SGTM_SERVER_EVENT_FIRED', 'EVENT_ID_CONSISTENCY_CLIENT_TO_SERVER',
      'PHONE_CAPTURED_FOR_CAPI', 'PII_PROPERLY_HASHED', 'FBCLID_PERSISTS_TO_CONVERSION',
    ],
    ga4: [
      'GA4_PURCHASE_EVENT_FIRED', 'DATALAYER_POPULATED',
      'TRANSACTION_ID_PRESENT', 'ITEMS_ARRAY_POPULATED',
    ],
    gtm: ['GTM_CONTAINER_LOADED', 'DATALAYER_POPULATED'],
    sgtm: ['SGTM_SERVER_EVENT_FIRED', 'EVENT_ID_CONSISTENCY_CLIENT_TO_SERVER'],
  };

  const ruleIds = platformRuleMap[platform.platform] ?? [];
  const resultMap = new Map(validationResults.map((r) => [r.rule_id, r]));

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{label}</CardTitle>
          <Badge className={cfg.badge}>{cfg.label}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{platform.risk_explanation}</p>
      </CardHeader>

      {ruleIds.length > 0 && (
        <CardContent>
          <ul className="space-y-2">
            {ruleIds.map((ruleId) => {
              const result = resultMap.get(ruleId);
              if (!result) return null;

              const pass = result.status === 'pass';
              const warn = result.status === 'warning';
              const usePassLabel = pass || warn;

              return (
                <li key={ruleId} className="flex items-center gap-2.5 text-sm">
                  <span
                    className={cn(
                      'shrink-0 text-base leading-none',
                      pass ? 'text-green-500' : warn ? 'text-yellow-500' : 'text-red-500'
                    )}
                    aria-hidden="true"
                  >
                    {pass ? '✔' : warn ? '⚠' : '✖'}
                  </span>
                  <span className={pass ? 'text-muted-foreground' : 'font-medium'}>
                    {RULE_LABELS[ruleId]
                      ? (usePassLabel ? RULE_LABELS[ruleId].pass : RULE_LABELS[ruleId].fail)
                      : ruleId}
                  </span>
                </li>
              );
            })}
          </ul>

          {platform.failed_rules.length > 0 && (
            <>
              <Separator className="mt-4" />
              <a href="#issues" className="mt-3 block text-sm font-medium text-brand-600 hover:text-brand-700">
                View fixes for {label} →
              </a>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}

interface Props {
  report: ReportJSON;
}

export function PlatformImpact({ report }: Props) {
  const { platform_breakdown, technical_appendix } = report;
  const validationResults = technical_appendix.validation_results;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Platform Impact</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          How signal issues affect each advertising platform.
        </p>
      </div>

      {platform_breakdown.map((platform) => (
        <PlatformCard
          key={platform.platform}
          platform={platform}
          validationResults={validationResults as ValidationResult[]}
        />
      ))}

      {platform_breakdown.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-sm text-muted-foreground">No platform data available.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
