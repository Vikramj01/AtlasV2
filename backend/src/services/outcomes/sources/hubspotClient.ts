/**
 * HubSpot CRM API v3 client — implements CrmProvider.
 *
 * Auth: Bearer access_token, refreshed via hubspotOAuth.ts's
 * refreshAccessToken() when a caller detects a 401 (the orchestrator's job
 * in Sprint 4 — this client does not refresh itself, matching how
 * googleAdsSync.ts et al. rely on a caller-level refresh, not a client-level
 * one).
 *
 * listPipelines() intentionally has no object-type parameter, matching the
 * CrmProvider interface (docs/prd/crm-outcome-integration.md §4.2) exactly.
 * HubSpot's Pipelines API is itself object-scoped (GET /crm/v3/pipelines/
 * {objectType}) and only deals (and tickets, out of scope) have a real
 * pipeline concept — contacts only have a flat `lifecyclestage` property,
 * not a pipeline with ordered stages. Since crm_stage_mappings.tracked_object
 * defaults to 'deal' and this PRD's ladder is deal-centric, listPipelines()
 * always lists the deals pipelines. Revisit if a contact-tracked ladder is
 * ever needed — HubSpot has no pipeline object to list for that case.
 *
 * HubSpot CRM API docs: https://developers.hubspot.com/docs/reference/api/crm
 *
 * writeAttribution() (Sprint 9, D3, §6.4) lazily creates each Atlas-
 * namespaced write-back property the first time this call actually has a
 * value for it (never all four up front — atlas_attributed_campaign has no
 * resolvable data source anywhere in this codebase today, so it is never
 * created until outcomeDelivery.ts actually has a campaign name to give
 * it), then PATCHes the record. Property creation is idempotent — HubSpot
 * returns 409 for a name that already exists on that object type, treated
 * as success. This sandbox's egress proxy blocks api.hubapi.com (same
 * class of restriction as the other vendor docs blocked per Key Technical
 * Decision §14/§24 and Sprint 0's ingestWindows.ts note), so the Properties
 * API's exact create-payload shape (type/fieldType/groupName) could not be
 * re-verified live here — built from HubSpot's stable, well-documented CRM
 * v3 surface (the same distinction CLAUDE.md draws between this API and
 * the actually-drifted Data Manager API). Re-verify against a live portal
 * before this reaches a real client. All four write-back properties are
 * modelled as plain string type (not HubSpot's special 'datetime' type,
 * which requires a specific midnight-UTC-milliseconds value format that
 * could not be verified live either) — atlas_last_delivered_at is a plain
 * ISO 8601 string, always human-readable and never at risk of that
 * footgun.
 */

import type {
  CrmProvider,
  CrmProviderName,
  OutcomeObjectType,
  DecryptedTokens,
  CrmAccountInfo,
  CrmPipeline,
  CrmProperty,
  CrmRecord,
} from './types';
import logger from '@/utils/logger';

const API_BASE = 'https://api.hubapi.com';
const SEARCH_PAGE_SIZE = 100;

// The property that carries a record's pipeline stage, per object type.
// Used by fetchChangedRecords to populate CrmRecord.stage_id/stage_changed_at.
const STAGE_PROPERTY_BY_OBJECT: Record<OutcomeObjectType, string> = {
  deal: 'dealstage',
  contact: 'lifecyclestage',
};

function objectPath(object: OutcomeObjectType): 'deals' | 'contacts' {
  return object === 'deal' ? 'deals' : 'contacts';
}

// HubSpot's own default built-in property group per object type — every
// portal has these, so a custom property can always be created into one
// without first checking it exists.
const DEFAULT_PROPERTY_GROUP: Record<OutcomeObjectType, string> = {
  deal: 'dealinformation',
  contact: 'contactinformation',
};

async function hubspotFetch(
  path: string,
  tokens: DecryptedTokens,
  init: RequestInit = {},
): Promise<Response> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });

  // Single retry on rate limit, honouring Retry-After when present — the
  // orchestrator's own exponential backoff (Sprint 4) handles repeated 429s
  // across sync runs; this is just enough for a client call not to fail on
  // a single transient burst.
  if (response.status === 429) {
    const retryAfterS = parseInt(response.headers.get('Retry-After') ?? '2', 10);
    logger.warn({ path, retryAfterS }, 'HubSpot API rate limited — retrying once');
    await new Promise((resolve) => setTimeout(resolve, retryAfterS * 1000));
    return fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });
  }

  return response;
}

interface HubSpotTokenInfo {
  hub_id: number;
  hub_domain: string;
  user: string;
  scopes: string[];
}

interface HubSpotPipelineStage {
  id: string;
  label: string;
  displayOrder: number;
  metadata?: { isClosed?: string | boolean; probability?: string | number };
}

interface HubSpotPipeline {
  id: string;
  label: string;
  displayOrder: number;
  stages: HubSpotPipelineStage[];
}

interface HubSpotProperty {
  name: string;
  label: string;
  type: string;
}

interface HubSpotSearchResult {
  id: string;
  properties: Record<string, string | null>;
}

interface HubSpotSearchResponse {
  results: HubSpotSearchResult[];
  paging?: { next?: { after: string } };
}

export const hubspotClient: CrmProvider = {
  name: 'hubspot' as CrmProviderName,

  async testConnection(tokens: DecryptedTokens): Promise<CrmAccountInfo> {
    // The access-token-info endpoint takes the token in the URL path itself
    // (not a Bearer header) — it's HubSpot's own token introspection route,
    // distinct from every other call this client makes.
    const response = await fetch(`${API_BASE}/oauth/v1/access-tokens/${tokens.access_token}`);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HubSpot testConnection failed (${response.status}): ${body}`);
    }
    const info = await response.json() as HubSpotTokenInfo;
    return {
      account_id: String(info.hub_id),
      account_label: info.hub_domain,
    };
  },

  async listPipelines(tokens: DecryptedTokens): Promise<CrmPipeline[]> {
    const response = await hubspotFetch('/crm/v3/pipelines/deals', tokens);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HubSpot listPipelines failed (${response.status}): ${body}`);
    }
    const body = await response.json() as { results: HubSpotPipeline[] };
    return body.results.map((pipeline) => ({
      id: pipeline.id,
      label: pipeline.label,
      stages: pipeline.stages
        .slice()
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map((stage) => ({
          id: stage.id,
          label: stage.label,
          display_order: stage.displayOrder,
          metadata: stage.metadata
            ? {
                is_closed: stage.metadata.isClosed === true || stage.metadata.isClosed === 'true',
                probability: stage.metadata.probability != null ? Number(stage.metadata.probability) : null,
              }
            : undefined,
        })),
    }));
  },

  async listProperties(tokens: DecryptedTokens, object: OutcomeObjectType): Promise<CrmProperty[]> {
    const response = await hubspotFetch(`/crm/v3/properties/${objectPath(object)}`, tokens);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HubSpot listProperties failed (${response.status}): ${body}`);
    }
    const body = await response.json() as { results: HubSpotProperty[] };
    return body.results.map((prop) => ({
      name: prop.name,
      label: prop.label,
      type: prop.type,
    }));
  },

  async *fetchChangedRecords(
    tokens: DecryptedTokens,
    object: OutcomeObjectType,
    since: Date,
    until: Date,
    propertyNames: string[],
  ): AsyncIterable<CrmRecord> {
    const stageProperty = STAGE_PROPERTY_BY_OBJECT[object];
    // hs_lastmodifieddate is read as this record's stage-change timestamp.
    // HubSpot has no generic "this property changed at this time" field for
    // an arbitrary property on the free/starter tiers this client targets —
    // Sprint 4's orchestrator treats this as an approximation, not an exact
    // per-stage transition time.
    const properties = Array.from(new Set([...propertyNames, stageProperty, 'hs_lastmodifieddate']));

    let after: string | undefined;
    do {
      const body: Record<string, unknown> = {
        filterGroups: [{
          filters: [{
            propertyName: 'hs_lastmodifieddate',
            operator: 'BETWEEN',
            value: since.getTime().toString(),
            highValue: until.getTime().toString(),
          }],
        }],
        sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'ASCENDING' }],
        properties,
        limit: SEARCH_PAGE_SIZE,
      };
      if (after) body.after = after;

      const response = await hubspotFetch(`/crm/v3/objects/${objectPath(object)}/search`, tokens, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`HubSpot fetchChangedRecords failed (${response.status}): ${errBody}`);
      }

      const page = await response.json() as HubSpotSearchResponse;
      for (const result of page.results) {
        const stageChangedAtMs = Number(result.properties.hs_lastmodifieddate);
        yield {
          id: result.id,
          object,
          stage_id: result.properties[stageProperty] ?? null,
          stage_changed_at: Number.isFinite(stageChangedAtMs)
            ? new Date(stageChangedAtMs).toISOString()
            : null,
          properties: result.properties,
        };
      }

      after = page.paging?.next?.after;
    } while (after);
  },

  async writeAttribution(
    tokens: DecryptedTokens,
    object: OutcomeObjectType,
    recordId: string,
    properties: Record<string, string>,
  ): Promise<void> {
    const propertyNames = Object.keys(properties);
    if (propertyNames.length === 0) return;

    // Idempotent create — one call per property this call actually has a
    // value for, never a bulk up-front creation of all four write-back
    // properties (atlas_attributed_campaign in particular is never created
    // until there is a real campaign name to give it).
    for (const name of propertyNames) {
      const response = await hubspotFetch(`/crm/v3/properties/${objectPath(object)}`, tokens, {
        method: 'POST',
        body: JSON.stringify({
          name,
          label: name,
          type: 'string',
          fieldType: 'text',
          groupName: DEFAULT_PROPERTY_GROUP[object],
        }),
      });
      if (!response.ok && response.status !== 409) {
        const body = await response.text();
        throw new Error(`HubSpot writeAttribution: failed to ensure property '${name}' exists (${response.status}): ${body}`);
      }
    }

    const response = await hubspotFetch(`/crm/v3/objects/${objectPath(object)}/${recordId}`, tokens, {
      method: 'PATCH',
      body: JSON.stringify({ properties }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HubSpot writeAttribution failed (${response.status}): ${body}`);
    }
  },
};
