/**
 * Composable Output Generator
 *
 * Takes a client's deployed signal packs and generates:
 * 1. GTM container JSON   (reuses existing gtmContainerGenerator patterns)
 * 2. WalkerOS flow.json   (modular, client-specific config referencing shared signal packs)
 * 3. dataLayer spec       (per-page developer code snippets)
 *
 * This is the agency/composable path. It runs synchronously in the route handler
 * (outputs are fast to compute — no Browserbase, no Claude API).
 */

import type { ClientWithDetails } from '@/types/organisation';
import type { ClientOutput, DeploymentWithSignals, SignalWithOverrides } from '@/types/signal';
import { resolveDeploymentsForClient } from '@/services/database/signalQueries';
import { listDeployments, saveClientOutput, markDeploymentGenerated } from '@/services/database/clientQueries';
import { generateWalkerOSFlow } from './walkerosComposableGenerator';
import logger from '@/utils/logger';

// ── GTM container generation from resolved signals ────────────────────────────

function buildGTMContainer(
  client: ClientWithDetails,
  allSignals: SignalWithOverrides[],
): Record<string, unknown> {
  const tags: unknown[] = [];
  const triggers: unknown[] = [];
  const variables: unknown[] = [];

  // GA4 Configuration tag
  const ga4Platform = client.platforms.find((p) => p.platform === 'ga4' && p.is_active);
  if (ga4Platform) {
    const measurementId = ga4Platform.measurement_id ?? 'G-XXXXXXXXXX';
    tags.push({
      name: `Atlas — GA4 Configuration`,
      type: 'googtag',
      parameter: [
        { type: 'template', key: 'tagId', value: measurementId },
      ],
      firingRuleId: ['{{All Pages}}'],
    });
  }

  // Conversion Linker for Google Ads click ID capture
  const googleAdsPlatform = client.platforms.find((p) => p.platform === 'google_ads' && p.is_active);
  if (googleAdsPlatform) {
    tags.push({
      name: 'Atlas — Conversion Linker',
      type: 'flc',
      firingRuleId: ['{{All Pages}}'],
    });
  }

  // Meta Pixel base code
  const metaPlatform = client.platforms.find((p) => p.platform === 'meta' && p.is_active);
  if (metaPlatform) {
    const pixelId = metaPlatform.measurement_id ?? '0000000000';
    tags.push({
      name: 'Atlas — Meta Pixel Base',
      type: 'sp',
      parameter: [
        { type: 'template', key: 'pixelId', value: pixelId },
        { type: 'template', key: 'trackType', value: 'PageView' },
      ],
      firingRuleId: ['{{All Pages}}'],
    });
  }

  // Page view trigger
  triggers.push({ name: 'All Pages', type: 'pageview' });

  // One tag + trigger per signal per active platform
  for (const { signal, stage_assignment } of allSignals) {
    const triggerName = `Atlas — dataLayer: ${signal.key}`;
    triggers.push({
      name: triggerName,
      type: 'customEvent',
      filter: [
        {
          type: 'equals',
          parameter: [
            { type: 'template', key: 'arg0', value: '{{Event}}' },
            { type: 'template', key: 'arg1', value: signal.key },
          ],
        },
      ],
    });

    // GA4 event tag
    if (ga4Platform) {
      const ga4Mapping = signal.platform_mappings?.['ga4'];
      if (ga4Mapping) {
        const paramsList = Object.entries(ga4Mapping.param_mapping ?? {}).map(
          ([key, val]) => ({ type: 'template', key, value: `{{dlv - ${val}}}` }),
        );
        tags.push({
          name: `Atlas — GA4: ${signal.name}${stage_assignment ? ` (${stage_assignment})` : ''}`,
          type: 'gaawe',
          parameter: [
            { type: 'template', key: 'eventName', value: ga4Mapping.event_name },
            { type: 'list', key: 'eventParameters', list: paramsList },
          ],
          firingRuleId: [triggerName],
        });
      }
    }

    // Google Ads conversion tag
    if (googleAdsPlatform && signal.category === 'conversion') {
      const adsMappings = signal.platform_mappings?.['google_ads'];
      if (adsMappings) {
        const conversionId = googleAdsPlatform.measurement_id ?? 'AW-XXXXXXXXXX/YYYYYY';
        tags.push({
          name: `Atlas — Google Ads: ${signal.name}`,
          type: 'awct',
          parameter: [
            { type: 'template', key: 'conversionId', value: conversionId.split('/')[0] },
            { type: 'template', key: 'conversionLabel', value: conversionId.split('/')[1] ?? '' },
            { type: 'template', key: 'value', value: `{{dlv - ${adsMappings.param_mapping?.['value'] ?? 'value'}}}` },
            { type: 'template', key: 'currency', value: `{{dlv - ${adsMappings.param_mapping?.['currency'] ?? 'currency'}}}` },
          ],
          firingRuleId: [triggerName],
        });
      }
    }

    // Meta Pixel event tag
    if (metaPlatform) {
      const metaMapping = signal.platform_mappings?.['meta'];
      if (metaMapping) {
        tags.push({
          name: `Atlas — Meta: ${signal.name}`,
          type: 'sp',
          parameter: [
            { type: 'template', key: 'pixelId', value: metaPlatform.measurement_id ?? '0000000000' },
            { type: 'template', key: 'trackType', value: 'trackCustom' },
            { type: 'template', key: 'standardEventType', value: metaMapping.event_name },
          ],
          firingRuleId: [triggerName],
        });
      }
    }

    // Add dataLayer variables for required params
    for (const param of signal.required_params) {
      variables.push({
        name: `dlv - ${param.key}`,
        type: 'dlv',
        parameter: [{ type: 'template', key: 'name', value: param.key }],
      });
    }
  }

  return {
    exportFormatVersion: 2,
    exportTime: new Date().toISOString(),
    containerVersion: {
      tag: tags,
      trigger: triggers,
      variable: variables,
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
  const gtmData = buildGTMContainer(client, allSignals);
  const gtmOutput = await saveClientOutput(clientId, 'gtm_container', gtmData, sourceDeployments);
  outputs.push(gtmOutput);

  // 2. WalkerOS flow
  const walkerosData = generateWalkerOSFlow(client, deploymentData);
  const walkerosOutput = await saveClientOutput(clientId, 'walkeros_flow', walkerosData, sourceDeployments);
  outputs.push(walkerosOutput);

  // 3. dataLayer spec
  const specData = buildDataLayerSpec(client, allSignals);
  const specOutput = await saveClientOutput(clientId, 'datalayer_spec', specData, sourceDeployments);
  outputs.push(specOutput);

  // Mark all deployments as generated
  const deployments = await listDeployments(clientId);
  await Promise.all(deployments.map((d) => markDeploymentGenerated(d.id)));

  logger.info({ clientId, outputCount: outputs.length, signalCount: allSignals.length }, 'Composable outputs generated');

  return outputs;
}
