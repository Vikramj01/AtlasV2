/**
 * GA4 Admin configuration rules (GA4 Admin / L11 / Junk Gate PRD §A.4). Pure:
 * every input is resolved by `ga4ConfigDiff.ts` first ("resolve outside, read
 * inside", Key Technical Decision §16). A rule fires only on what the snapshot
 * actually observed — a section the snapshot marks not observed (`null`)
 * produces no finding, never an absence claim.
 */
import type { Ga4ConfigSnapshot } from '../sync/ga4ConfigSync';
import type { FindingCode } from '../codes/findingCodes';

/** GA4 event names that represent a form submission / lead for the double-count check. */
export const GA4_LEAD_EVENT_NAMES = ['generate_lead', 'form_submit', 'sign_up'] as const;

export interface Ga4RuleInput {
  snapshot: Ga4ConfigSnapshot;
  /** GA4 measurement IDs (`G-…`) the client's GTM container sends to. null = no container known. */
  containerMeasurementIds: string[] | null;
  /** Hostnames the client is known by (website_url + secondary_domains), lower-case, no `www.`. */
  clientHosts: string[];
  /** Google Ads customer IDs (digits) connected to this client. */
  adsCustomerIds: string[];
  /** Manager (MCC) IDs of those connections — a GA4 link to the manager is an acceptable link. */
  adsManagerIds: string[];
  /** Currency/time zone of the connected Ads customer; null = not observed. */
  adsCustomer: { currency_code: string | null; time_zone: string | null } | null;
  /** GA4 events this client's deployed signals / journey conversion stages send. */
  leadSignalEvents: string[];
  /** GA4 events of journey conversion stages. */
  conversionEvents: string[];
  /** Key events on the property, or null when the key-event sync has not run. */
  keyEventNames: string[] | null;
}

export interface Ga4RuleFinding {
  code: FindingCode;
  expected: Record<string, unknown> | null;
  observed: Record<string, unknown> | null;
  context: Record<string, string>;
}

export function normaliseHost(raw: string): string {
  let h = raw.trim().toLowerCase();
  h = h.replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0].split(':')[0];
  return h.replace(/^www\./, '');
}

function hostMatches(streamHost: string, clientHost: string): boolean {
  return streamHost === clientHost || streamHost.endsWith(`.${clientHost}`) || clientHost.endsWith(`.${streamHost}`);
}

const list = (xs: string[]): string => (xs.length > 0 ? xs.join(', ') : 'none');

export function evaluateGa4ConfigRules(input: Ga4RuleInput): Ga4RuleFinding[] {
  const { snapshot } = input;
  const out: Ga4RuleFinding[] = [];
  const property = snapshot.property_id;
  const streams = snapshot.web_streams;
  const streamIds = streams.map((s) => s.measurement_id).filter((x): x is string => !!x);

  // GA4_STREAM_ID_NOT_IN_PROPERTY — one finding per container ID with no matching stream.
  if (input.containerMeasurementIds) {
    const known = new Set(streamIds.map((i) => i.toUpperCase()));
    for (const id of input.containerMeasurementIds) {
      if (!known.has(id.toUpperCase())) {
        out.push({
          code: 'GA4_STREAM_ID_NOT_IN_PROPERTY',
          expected: { measurement_ids: streamIds },
          observed: { container_measurement_id: id },
          context: { measurement_id: id, property_id: property, stream_ids: list(streamIds) },
        });
      }
    }
  }

  // GA4_STREAM_DOMAIN_MISMATCH — streams observed, client hosts known, none line up.
  const streamHosts = streams.map((s) => (s.default_uri ? normaliseHost(s.default_uri) : '')).filter(Boolean);
  if (streamHosts.length > 0 && input.clientHosts.length > 0) {
    const matched = streamHosts.some((sh) => input.clientHosts.some((ch) => hostMatches(sh, ch)));
    if (!matched) {
      out.push({
        code: 'GA4_STREAM_DOMAIN_MISMATCH',
        expected: { client_hosts: input.clientHosts },
        observed: { stream_hosts: streamHosts },
        context: { property_id: property, client_domains: list(input.clientHosts), stream_domains: list(streamHosts) },
      });
    }
  }

  // GA4_ENHANCED_FORM_DOUBLE_COUNT — enhanced form interactions on (observed) + lead event sent to GA4.
  const leadEvents = [...new Set(input.leadSignalEvents.filter((e) => (GA4_LEAD_EVENT_NAMES as readonly string[]).includes(e)))];
  if (leadEvents.length > 0) {
    for (const s of streams) {
      const em = s.enhanced_measurement;
      if (em && em.stream_enabled && em.form_interactions_enabled) {
        out.push({
          code: 'GA4_ENHANCED_FORM_DOUBLE_COUNT',
          expected: null,
          observed: { stream_id: s.stream_id, form_interactions_enabled: true, signal_events: leadEvents },
          context: { stream_id: s.stream_id, signal_events: list(leadEvents) },
        });
      }
    }
  }

  // GA4_ADS_LINK_MISSING + currency/time zone — only when the links section was observed.
  if (snapshot.ads_links && input.adsCustomerIds.length > 0) {
    const linked = new Set(snapshot.ads_links.map((l) => l.customer_id));
    const acceptable = new Set([...input.adsCustomerIds, ...input.adsManagerIds]);
    const linkedToClient = [...acceptable].some((id) => linked.has(id));
    if (!linkedToClient) {
      out.push({
        code: 'GA4_ADS_LINK_MISSING',
        expected: { ads_customer_ids: input.adsCustomerIds },
        observed: { linked_customer_ids: [...linked] },
        context: { property_id: property, ads_customer_id: input.adsCustomerIds.join(', '), linked_customers: list([...linked]) },
      });
    } else if (input.adsCustomer) {
      const ga4Currency = snapshot.currency_code;
      const adsCurrency = input.adsCustomer.currency_code;
      if (ga4Currency && adsCurrency && ga4Currency.toUpperCase() !== adsCurrency.toUpperCase()) {
        out.push({
          code: 'GA4_ADS_CURRENCY_MISMATCH',
          expected: { currency: adsCurrency },
          observed: { currency: ga4Currency },
          context: { property_id: property, ga4_currency: ga4Currency, ads_currency: adsCurrency },
        });
      }
      const ga4Tz = snapshot.time_zone;
      const adsTz = input.adsCustomer.time_zone;
      if (ga4Tz && adsTz && ga4Tz.toLowerCase() !== adsTz.toLowerCase()) {
        out.push({
          code: 'GA4_ADS_TIMEZONE_MISMATCH',
          expected: { time_zone: adsTz },
          observed: { time_zone: ga4Tz },
          context: { property_id: property, ga4_time_zone: ga4Tz, ads_time_zone: adsTz },
        });
      }
    }
  }

  // GA4_SIGNAL_NOT_KEY_EVENT — needs a completed key-event sync to compare against.
  if (input.keyEventNames) {
    const keys = new Set(input.keyEventNames);
    for (const ev of [...new Set(input.conversionEvents)]) {
      if (!keys.has(ev)) {
        out.push({
          code: 'GA4_SIGNAL_NOT_KEY_EVENT',
          expected: { key_event: ev },
          observed: { key_events: input.keyEventNames },
          context: { event_name: ev, property_id: property, key_events: list(input.keyEventNames) },
        });
      }
    }
  }

  return out;
}
