import type { ReportJSON, PlatformBreakdown, ValidationResult } from '@/types/audit';
import { PLATFORM_LABELS } from '@/utils/languageMap';

const PLATFORM_STATUS_CONFIG = {
  healthy:  { badge: 'bg-green-100 text-green-700',  label: 'Healthy' },
  at_risk:  { badge: 'bg-yellow-100 text-yellow-700', label: 'At Risk' },
  broken:   { badge: 'bg-red-100 text-red-700',       label: 'Broken' },
};

// Map rule_id to pass/fail labels so the text always matches the icon
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

  // Get relevant rules for this platform
  const relevantResults = validationResults.filter(
    (r) => !platform.failed_rules || true // show all rules that have been run
  );
  // Filter to rules that mention this platform — use failed_rules as the fail set
  const failedSet = new Set(platform.failed_rules);

  // Show a curated checklist for known platforms
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
  const resultMap = new Map(relevantResults.map((r) => [r.rule_id, r]));

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-gray-900">{label}</h3>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${cfg.badge}`}>
          {cfg.label}
        </span>
      </div>

      {/* Risk summary */}
      <p className="mt-2 text-sm text-gray-600">{platform.risk_explanation}</p>

      {/* Checklist */}
      {ruleIds.length > 0 && (
        <ul className="mt-4 space-y-2">
          {ruleIds.map((ruleId) => {
            const result = resultMap.get(ruleId);
            const failed = failedSet.has(ruleId);
            const status = result?.status;
            const pass = status === 'pass' && !failed;

            return (
              <li key={ruleId} className="flex items-center gap-2.5 text-sm">
                <span
                  className={`shrink-0 text-base leading-none ${
                    pass ? 'text-green-500' : status === 'warning' ? 'text-yellow-500' : 'text-red-500'
                  }`}
                  aria-hidden="true"
                >
                  {pass ? '✔' : status === 'warning' ? '⚠' : '✖'}
                </span>
                <span className={pass ? 'text-gray-700' : 'text-gray-900 font-medium'}>
                  {RULE_LABELS[ruleId]
                    ? (pass ? RULE_LABELS[ruleId].pass : RULE_LABELS[ruleId].fail)
                    : ruleId}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {/* CTA if there are issues */}
      {platform.failed_rules.length > 0 && (
        <div className="mt-4 pt-3 border-t border-gray-100">
          <a href="#issues" className="text-sm font-medium text-brand-600 hover:text-brand-700">
            View fixes for {label} →
          </a>
        </div>
      )}
    </div>
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
        <h2 className="text-lg font-semibold text-gray-900">Platform Impact</h2>
        <p className="mt-1 text-sm text-gray-500">
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
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
          <p className="text-sm text-gray-400">No platform data available.</p>
        </div>
      )}
    </div>
  );
}
