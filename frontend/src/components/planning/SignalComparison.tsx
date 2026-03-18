/**
 * SignalComparison — Cross-platform signal coverage matrix
 *
 * Read-only view derived from the session's approved recommendations.
 * Shows which parameters each ad platform receives for each conversion event.
 *
 * Columns: Data Layer | GA4 | Google Ads | Meta | TikTok | LinkedIn
 * Rows:    Each unique event from approved recommendations
 */

import type { PlanningRecommendation } from '@/types/planning';

interface SignalComparisonProps {
  recommendations: PlanningRecommendation[];
  selectedPlatforms: string[];
}

// ── Platform definitions ──────────────────────────────────────────────────────

interface PlatformDef {
  key: string;
  label: string;
  shortLabel: string;
  color: string;
}

const ALL_PLATFORMS: PlatformDef[] = [
  { key: 'data_layer', label: 'Data Layer',    shortLabel: 'DL',        color: 'bg-gray-100 text-gray-700' },
  { key: 'ga4',        label: 'GA4',           shortLabel: 'GA4',       color: 'bg-blue-100 text-blue-700' },
  { key: 'google_ads', label: 'Google Ads',    shortLabel: 'Ads',       color: 'bg-green-100 text-green-700' },
  { key: 'meta',       label: 'Meta',          shortLabel: 'Meta',      color: 'bg-indigo-100 text-indigo-700' },
  { key: 'tiktok',     label: 'TikTok',        shortLabel: 'TikTok',    color: 'bg-pink-100 text-pink-700' },
  { key: 'linkedin',   label: 'LinkedIn',      shortLabel: 'LinkedIn',  color: 'bg-sky-100 text-sky-700' },
];

// ── Parameter mapping per platform & action type ──────────────────────────────

type ParamStatus = 'present' | 'recommended' | 'not_applicable';

interface PlatformParams {
  [param: string]: ParamStatus;
}

function getParamsForPlatform(platform: string, actionType: string): PlatformParams {
  const isEcommerce = ['purchase', 'add_to_cart', 'begin_checkout', 'view_item'].includes(actionType);
  const isConversion = ['purchase', 'generate_lead', 'sign_up'].includes(actionType);

  switch (platform) {
    case 'data_layer':
      return {
        event: 'present',
        ...(isEcommerce ? {
          'ecommerce.value': 'present',
          'ecommerce.currency': 'present',
          'ecommerce.items': 'present',
          ...(actionType === 'purchase' ? { 'ecommerce.transaction_id': 'present' } : {}),
        } : {}),
        ...(actionType === 'generate_lead' ? { form_id: 'present', value: 'present' } : {}),
        'user_data.email': 'recommended',
        'user_data.phone': 'recommended',
        gclid: 'present',
        fbclid: 'present',
      };

    case 'ga4':
      return {
        event_name: 'present',
        ...(isEcommerce ? {
          value: 'present',
          currency: 'present',
          items: 'present',
          ...(actionType === 'purchase' ? { transaction_id: 'present' } : {}),
        } : {}),
        ...(actionType === 'generate_lead' ? { form_id: 'present' } : {}),
        user_id: 'recommended',
      };

    case 'google_ads':
      if (!isConversion) return { conversion_event: 'not_applicable' };
      return {
        conversion_id: 'present',
        conversion_label: 'present',
        ...(actionType === 'purchase' ? {
          value: 'present',
          currency: 'present',
          order_id: 'present',
        } : {}),
        gclid: 'present',
        enhanced_conversions_email: 'recommended',
      };

    case 'meta':
      return {
        event_name: 'present',
        ...(isEcommerce ? {
          value: 'present',
          currency: 'present',
          content_type: 'present',
        } : {}),
        fbc: 'present',
        fbp: 'present',
        em: 'recommended',
        ph: 'recommended',
        external_id: 'recommended',
      };

    case 'tiktok':
      return {
        event_name: 'present',
        ...(actionType === 'purchase' ? {
          value: 'present',
          currency: 'present',
          content_type: 'present',
        } : {}),
      };

    case 'linkedin':
      if (!isConversion) return { conversion_event: 'not_applicable' };
      return {
        conversion_id: 'present',
        partner_id: 'present',
      };

    default:
      return {};
  }
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status, param }: { status: ParamStatus; param: string }) {
  if (status === 'not_applicable') {
    return (
      <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-medium bg-gray-50 text-gray-400">
        N/A
      </span>
    );
  }
  if (status === 'present') {
    return (
      <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-mono font-medium bg-green-50 text-green-700 border border-green-200">
        {param}
      </span>
    );
  }
  // recommended
  return (
    <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-mono font-medium bg-amber-50 text-amber-700 border border-amber-200 border-dashed">
      {param}?
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function SignalComparison({ recommendations, selectedPlatforms }: SignalComparisonProps) {
  // Deduplicate events from approved recommendations
  const eventMap = new Map<string, { eventName: string; actionType: string }>();
  for (const rec of recommendations) {
    if (!eventMap.has(rec.event_name)) {
      eventMap.set(rec.event_name, {
        eventName: rec.event_name,
        actionType: rec.action_type,
      });
    }
  }
  const events = Array.from(eventMap.values());

  if (events.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        No approved events to display. Approve recommendations in Step 4 to see signal coverage.
      </div>
    );
  }

  // Platforms to show: data_layer always + whatever platforms the session has
  const activePlatforms = ALL_PLATFORMS.filter(
    (p) => p.key === 'data_layer' || selectedPlatforms.includes(p.key)
  );

  // Summary stats
  const totalEvents = events.length;
  const platformsConnected = selectedPlatforms.length;

  return (
    <div className="space-y-4">
      {/* Summary row */}
      <div className="flex flex-wrap gap-3">
        <div className="rounded-lg border bg-background px-4 py-2.5">
          <p className="text-xs text-muted-foreground">Platforms</p>
          <p className="text-lg font-bold">{platformsConnected}<span className="text-sm text-muted-foreground font-normal">/{ALL_PLATFORMS.length - 1}</span></p>
        </div>
        <div className="rounded-lg border bg-background px-4 py-2.5">
          <p className="text-xs text-muted-foreground">Events tracked</p>
          <p className="text-lg font-bold">{totalEvents}</p>
        </div>
        <div className="rounded-lg border bg-background px-4 py-2.5">
          <p className="text-xs text-muted-foreground">Click ID capture</p>
          <p className="text-sm font-semibold text-green-600 mt-0.5">Active (GCLID + FBCLID)</p>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-mono bg-green-50 text-green-700 border border-green-200">param</span>
          Present &amp; configured
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-mono bg-amber-50 text-amber-700 border border-amber-200 border-dashed">param?</span>
          Recommended (not yet configured)
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block rounded px-1.5 py-0.5 text-[10px] bg-gray-50 text-gray-400">N/A</span>
          Not applicable for this event type
        </div>
      </div>

      {/* Matrix table */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/30">
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground w-32">Event</th>
              {activePlatforms.map((p) => (
                <th key={p.key} className="px-3 py-3 text-center">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${p.color}`}>
                    {p.shortLabel}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {events.map(({ eventName, actionType }) => (
              <tr key={eventName} className="hover:bg-muted/20">
                <td className="px-4 py-3">
                  <span className="font-mono text-xs font-semibold text-foreground">{eventName}</span>
                </td>
                {activePlatforms.map((platform) => {
                  const params = getParamsForPlatform(platform.key, actionType);
                  const paramEntries = Object.entries(params);
                  return (
                    <td key={platform.key} className="px-3 py-3 align-top">
                      <div className="flex flex-wrap gap-1 justify-center">
                        {paramEntries.length === 0 ? (
                          <span className="text-xs text-muted-foreground/50">—</span>
                        ) : (
                          paramEntries.map(([param, status]) => (
                            <StatusBadge key={param} status={status} param={param} />
                          ))
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Parameters marked <span className="font-mono">?</span> are recommended but require additional configuration.
        Visit the CAPI Module to connect server-side identifiers.
      </p>
    </div>
  );
}
