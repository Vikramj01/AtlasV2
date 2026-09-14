/**
 * Composable Output Generator
 *
 * Takes a client's deployed signal packs and generates:
 * 1. GTM container JSON   (reuses existing gtmContainerGenerator patterns)
 * 2. dataLayer spec       (per-page developer code snippets)
 *
 * This is the agency/composable path. It runs synchronously in the route handler
 * (outputs are fast to compute — no Browserbase, no Claude API).
 */

import type { ClientWithDetails } from '@/types/organisation';
import type { ClientOutput, DeploymentWithSignals, SignalWithOverrides } from '@/types/signal';
import { resolveDeploymentsForClient } from '@/services/database/signalQueries';
import { listDeployments, saveClientOutput, markDeploymentGenerated } from '@/services/database/clientQueries';
import { getClientIdentityConfig } from '@/services/database/enrichmentQueries';
import type { ClientIdentityConfig } from '@/types/enrichment';
import type { GTMContainerJSON, GTMTagDef, GTMTriggerDef, GTMVariableDef, GTMParameter } from '@/services/planning/generators/gtmContainerGenerator';
import { buildDlvVariable } from '@/services/planning/generators/renderer/gtm.renderer';
import { renderGTMTrigger } from '@/services/planning/generators/renderer/trigger.renderer';
import { buildGoogleTagInfrastructure, buildAllPagesTrigger } from '@/services/planning/generators/renderer/googleTagArchitecture';
import logger from '@/utils/logger';

// ── GTM container generation from resolved signals ────────────────────────────
//
// Google Stack Alignment sprint plan, Sprint 3 (Correction 6 / C3): this used
// to be a bespoke, independently-hand-rolled GTM builder that diverged from
// gtmContainerGenerator.ts's Planning path and got real GTM field names
// wrong — a 'flc' (Floodlight Counter, a DoubleClick/Campaign Manager tag
// type) mislabeled as "Conversion Linker", 'googtag' used for what was
// actually a plain GA4-config shape, lowercase parameter/trigger type codes
// that match no real GTM field ('template'/'list'/'customEvent'/'pageview'
// instead of 'TEMPLATE'/'LIST'/'CUSTOM_EVENT'/'PAGEVIEW'), 'firingRuleId'
// (not a real GTM field — the field is 'firingTriggerId' and takes trigger
// IDs, never `{{Name}}`-interpolated strings), and Google Ads parameter keys
// that don't exist on the real `awct` tag (`value`/`currency` instead of
// `conversionValue`/`currencyCode`). None of that would have imported into
// GTM without error. This now reuses the same typed GTMTagDef/GTMTriggerDef/
// GTMVariableDef shapes and the same shared renderer helpers Planning uses,
// so the two paths can no longer structurally diverge.

let idCounter = 0;
function nextId(): string {
  return String(++idCounter);
}

// Google Stack Alignment sprint plan, Sprint 6 (C6): Enhanced Conversions
// params for the per-signal Google Ads awct tag, built only from identity
// fields this specific client actually has configured — unlike Planning's
// generator (which has no per-client identity data at generation time and
// so always emits fixed dataLayer-path references), Composable Signals
// generates against a real connected client, so "must not require fields a
// client does not have" is enforced literally here rather than by relying
// on an unpopulated dataLayer path resolving empty. References the same
// `DLV - {fieldPath}` variables buildIdentityVariables() already created —
// never creates a duplicate variable for the same field.
function buildEnhancedConversionsParams(identityConfig: ClientIdentityConfig | null): GTMParameter[] {
  if (!identityConfig) return [];
  const fields: Array<{ fieldPath: string | null; key: string }> = [
    { fieldPath: identityConfig.email_field, key: 'userDataEmail' },
    { fieldPath: identityConfig.phone_field, key: 'userDataPhoneNumber' },
    { fieldPath: identityConfig.first_name_field, key: 'userDataFirstName' },
    { fieldPath: identityConfig.last_name_field, key: 'userDataLastName' },
    { fieldPath: identityConfig.postal_code_field, key: 'userDataPostalCode' },
    { fieldPath: identityConfig.country_field, key: 'userDataCountry' },
  ];
  const configured = fields.filter((f) => f.fieldPath);
  if (configured.length === 0) return [];
  return [
    bool('enhancedConversionsEnabled', 'true'),
    ...configured.map((f) => tmpl(f.key, `{{DLV - ${f.fieldPath}}}`)),
  ];
}

function buildIdentityVariables(identityConfig: ClientIdentityConfig): GTMVariableDef[] {
  const fields: Array<{ fieldPath: string | null; label: string }> = [
    { fieldPath: identityConfig.email_field, label: 'email' },
    { fieldPath: identityConfig.phone_field, label: 'phone' },
    { fieldPath: identityConfig.first_name_field, label: 'first_name' },
    { fieldPath: identityConfig.last_name_field, label: 'last_name' },
    { fieldPath: identityConfig.postal_code_field, label: 'postal_code' },
    { fieldPath: identityConfig.country_field, label: 'country' },
    { fieldPath: identityConfig.external_id_field, label: 'external_id' },
    { fieldPath: identityConfig.fbc_field, label: 'fbc' },
    { fieldPath: identityConfig.fbp_field, label: 'fbp' },
    { fieldPath: identityConfig.gclid_field, label: 'gclid' },
  ];
  const vars: GTMVariableDef[] = [];
  for (const { fieldPath, label } of fields) {
    // buildDlvVariable reads the dataLayer at the client's own field name and
    // names the resulting variable "DLV - {fieldPath}" — the real DLV
    // variable shape (dataLayerVersion/setDefaultValue/name), matching what
    // Planning's own identity DLV vars already use.
    if (fieldPath) {
      vars.push(buildDlvVariable(fieldPath, nextId(), '', `Identity — ${label}`));
    }
  }
  return vars;
}

function tmpl(key: string, value: string): GTMParameter {
  return { type: 'TEMPLATE', key, value };
}

function bool(key: string, value: string): GTMParameter {
  return { type: 'BOOLEAN', key, value };
}

function metaPixelHtml(pixelId: string, event: 'PageView' | string, custom = false): string {
  const call = custom
    ? `fbq('trackCustom', '${event}');`
    : `fbq('track', '${event}');`;
  return `<script>
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${pixelId}');
${call}
</script>`;
}

export function buildGTMContainer(
  client: ClientWithDetails,
  allSignals: SignalWithOverrides[],
  identityConfig: ClientIdentityConfig | null,
): GTMContainerJSON {
  const tags: GTMTagDef[] = [];
  const triggers: GTMTriggerDef[] = [];
  const variables: GTMVariableDef[] = [];

  // Identity variables from client enrichment config
  if (identityConfig) {
    variables.push(...buildIdentityVariables(identityConfig));
  }

  // ── All Pages trigger ──────────────────────────────────────────────────────
  const allPagesTriggerId = nextId();
  triggers.push(buildAllPagesTrigger(allPagesTriggerId));

  const ga4Platform = client.platforms.find((p) => p.platform === 'ga4' && p.is_active);
  const googleAdsPlatform = client.platforms.find((p) => p.platform === 'google_ads' && p.is_active);
  const metaPlatform = client.platforms.find((p) => p.platform === 'meta' && p.is_active);

  // ── Sitewide Google tag architecture (GA4 Config + Conversion Linker) ────────
  // Shared with Planning's gtmContainerGenerator.ts — see googleTagArchitecture.ts.
  // This replaces what used to be a bespoke, broken inline implementation here
  // ('flc' mislabeled as "Conversion Linker", 'googtag' misused for a plain
  // GA4-config shape — see Correction 6 of the Google Stack Alignment sprint
  // plan). google_ads' conversion_id is historically stored on this table as
  // a single "AW-XXXXXXXXXX/YYYYYY" string (conversionId/label combined) —
  // the Conversion Linker tag itself only ever needs the AW- prefix.
  const googleTagInfra = buildGoogleTagInfrastructure(
    {
      ga4: ga4Platform ? { measurementId: ga4Platform.measurement_id ?? 'G-XXXXXXXXXX' } : undefined,
      googleAds: googleAdsPlatform
        ? { conversionId: (googleAdsPlatform.measurement_id ?? 'AW-XXXXXXXXXX').split('/')[0] }
        : undefined,
    },
    {
      allPagesTriggerId,
      secondaryDomains: client.secondary_domains,
      nextTagId: nextId,
      nextVarId: nextId,
    },
  );
  tags.push(...googleTagInfra.tags);
  variables.push(...googleTagInfra.variables);

  // ── Meta Pixel base code ───────────────────────────────────────────────────
  // Real GTM has no built-in Meta Pixel tag type — Custom HTML ('html') is
  // the correct real-world approach, matching gtmContainerGenerator.ts's own
  // Meta base pixel tag (the previous 'sp' type code here matched no real
  // GTM tag type at all).
  if (metaPlatform) {
    const pixelId = metaPlatform.measurement_id ?? '0000000000';
    const metaVarId = nextId();
    variables.push({
      accountId: '0', containerId: '0', fingerprint: '0', tagManagerUrl: 'https://tagmanager.google.com/',
      variableId: metaVarId,
      name: 'CONST - Meta Pixel ID',
      type: 'c',
      parameter: [tmpl('value', pixelId)],
    });
    tags.push({
      accountId: '0', containerId: '0', fingerprint: '0', tagManagerUrl: 'https://tagmanager.google.com/',
      tagId: nextId(),
      name: 'Atlas — Meta Pixel Base',
      type: 'html',
      parameter: [
        tmpl('html', metaPixelHtml('{{CONST - Meta Pixel ID}}', 'PageView')),
        { type: 'BOOLEAN', key: 'supportDocumentWrite', value: 'false' },
      ],
      firingTriggerId: [allPagesTriggerId],
      tagFiringOption: 'oncePerEvent',
    });
  }

  // One tag + trigger per signal per active platform
  for (const { signal, stage_assignment } of allSignals) {
    const signalTriggerId = nextId();
    triggers.push(renderGTMTrigger({ trigger_type: 'custom_event' }, signal.key, signalTriggerId, ''));

    // GA4 event tag
    if (ga4Platform) {
      const ga4Mapping = signal.platform_mappings?.['ga4'];
      if (ga4Mapping) {
        const paramsList: GTMParameter[] = Object.entries(ga4Mapping.param_mapping ?? {}).map(
          ([key, val]) => ({
            type: 'MAP',
            map: [tmpl('key', key), tmpl('value', `{{DLV - ${val}}}`)],
          }),
        );
        tags.push({
          accountId: '0', containerId: '0', fingerprint: '0', tagManagerUrl: 'https://tagmanager.google.com/',
          tagId: nextId(),
          name: `Atlas — GA4: ${signal.name}${stage_assignment ? ` (${stage_assignment})` : ''}`,
          type: 'gaawe',
          parameter: [
            tmpl('eventName', ga4Mapping.event_name),
            { type: 'LIST', key: 'eventParameters', list: paramsList },
          ],
          firingTriggerId: [signalTriggerId],
          tagFiringOption: 'oncePerEvent',
        });
      }
    }

    // Google Ads conversion tag
    if (googleAdsPlatform && signal.category === 'conversion') {
      const adsMappings = signal.platform_mappings?.['google_ads'];
      if (adsMappings) {
        const conversionId = googleAdsPlatform.measurement_id ?? 'AW-XXXXXXXXXX/YYYYYY';
        tags.push({
          accountId: '0', containerId: '0', fingerprint: '0', tagManagerUrl: 'https://tagmanager.google.com/',
          tagId: nextId(),
          name: `Atlas — Google Ads: ${signal.name}`,
          type: 'awct',
          parameter: [
            tmpl('conversionId', conversionId.split('/')[0]),
            tmpl('conversionLabel', conversionId.split('/')[1] ?? ''),
            tmpl('conversionValue', `{{DLV - ${adsMappings.param_mapping?.['value'] ?? 'value'}}}`),
            tmpl('currencyCode', `{{DLV - ${adsMappings.param_mapping?.['currency'] ?? 'currency'}}}`),
            ...buildEnhancedConversionsParams(identityConfig),
          ],
          firingTriggerId: [signalTriggerId],
          tagFiringOption: 'oncePerEvent',
        });
      }
    }

    // Meta Pixel event tag
    if (metaPlatform) {
      const metaMapping = signal.platform_mappings?.['meta'];
      if (metaMapping) {
        tags.push({
          accountId: '0', containerId: '0', fingerprint: '0', tagManagerUrl: 'https://tagmanager.google.com/',
          tagId: nextId(),
          name: `Atlas — Meta: ${signal.name}`,
          type: 'html',
          parameter: [
            tmpl('html', metaPixelHtml('{{CONST - Meta Pixel ID}}', metaMapping.event_name, true)),
            { type: 'BOOLEAN', key: 'supportDocumentWrite', value: 'false' },
          ],
          firingTriggerId: [signalTriggerId],
          tagFiringOption: 'oncePerEvent',
        });
      }
    }

    // Add dataLayer variables for required params
    for (const param of signal.required_params) {
      variables.push(buildDlvVariable(param.key, nextId(), ''));
    }
  }

  return {
    exportFormatVersion: 2,
    exportTime: new Date().toISOString(),
    containerVersion: {
      path: '', accountId: '0', containerId: '0', containerVersionId: '0', name: '', description: '',
      container: {
        path: '', accountId: '0', containerId: '0', name: client.name, publicId: '',
        usageContext: ['WEB'], fingerprint: '0', tagManagerUrl: 'https://tagmanager.google.com/',
      },
      tag: tags,
      trigger: triggers,
      variable: variables,
      folder: [],
      builtInVariable: [{ accountId: '0', containerId: '0', type: 'EVENT', name: 'Event' }],
      fingerprint: '0',
      tagManagerUrl: 'https://tagmanager.google.com/',
    },
  };
}

// ── dataLayer spec generation ─────────────────────────────────────────────────

function buildDataLayerSpec(
  client: ClientWithDetails,
  allSignals: SignalWithOverrides[],
): Record<string, unknown> {
  const pageSpecs: Record<string, unknown> = {};

  for (const page of client.pages ?? []) {
    const pageSignals = allSignals.filter(
      (s) => !s.stage_assignment || s.stage_assignment === page.page_type,
    );

    pageSpecs[page.page_type] = {
      url: page.url,
      label: page.label,
      signals: pageSignals.map(({ signal }) => ({
        event: signal.key,
        description: signal.description,
        required_params: signal.required_params,
        optional_params: signal.optional_params,
        example: buildDataLayerExample(signal),
      })),
    };
  }

  return {
    generated_at: new Date().toISOString(),
    client: client.name,
    website_url: client.website_url,
    pages: pageSpecs,
  };
}

function buildDataLayerExample(signal: SignalWithOverrides['signal']): string {
  const exampleParams: Record<string, unknown> = {};
  for (const param of signal.required_params) {
    exampleParams[param.key] = param.type === 'number' ? 99.99
      : param.type === 'array' ? [{ item_id: 'EXAMPLE_SKU', item_name: 'Example Product' }]
      : `YOUR_${param.key.toUpperCase()}`;
  }
  return `window.dataLayer = window.dataLayer || [];\nwindow.dataLayer.push(${JSON.stringify({ event: signal.key, ...exampleParams }, null, 2)});`;
}

// ── Main orchestrator ─────────────────────────────────────────────────────────

export async function generateComposableOutputs(
  client: ClientWithDetails,
  clientId: string,
): Promise<ClientOutput[]> {
  const deploymentData = await resolveDeploymentsForClient(clientId);

  if (deploymentData.length === 0) {
    throw new Error('No deployed signal packs found for this client');
  }

  // Deduplicate signals across packs (by signal key)
  const seenKeys = new Set<string>();
  const allSignals: SignalWithOverrides[] = [];
  for (const deployment of deploymentData) {
    for (const sw of deployment.signals) {
      if (!seenKeys.has(sw.signal.key)) {
        seenKeys.add(sw.signal.key);
        allSignals.push(sw);
      }
    }
  }

  // Build source_deployments metadata
  const sourceDeployments = deploymentData.map((d) => ({
    deployment_id: d.deployment_id,
    pack_id: d.pack_id,
    pack_version: 1,  // version is stored in the signal pack; simplified here
  }));

  const outputs: ClientOutput[] = [];

  // 1. GTM container
  const identityConfig = await getClientIdentityConfig(clientId).catch(() => null);
  const gtmData = buildGTMContainer(client, allSignals, identityConfig);
  const gtmOutput = await saveClientOutput(clientId, 'gtm_container', gtmData as unknown as Record<string, unknown>, sourceDeployments);
  outputs.push(gtmOutput);

  // 2. dataLayer spec
  const specData = buildDataLayerSpec(client, allSignals);
  const specOutput = await saveClientOutput(clientId, 'datalayer_spec', specData, sourceDeployments);
  outputs.push(specOutput);

  // Mark all deployments as generated
  const deployments = await listDeployments(clientId);
  await Promise.all(deployments.map((d) => markDeploymentGenerated(d.id)));

  logger.info({ clientId, outputCount: outputs.length, signalCount: allSignals.length }, 'Composable outputs generated');

  return outputs;
}
