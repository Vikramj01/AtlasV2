/**
 * Builds GTM container JSON and dataLayer spec from deployed signals for a client.
 * Reads from deployments JOIN signal_packs JOIN signal_pack_signals JOIN signals.
 * Does not persist — returns artifacts for preview or download.
 */
import { supabaseAdmin } from '../database/supabase';

export interface DataLayerEvent {
  signal_key: string;
  event_name: string;
  trigger: string;
  datalayer_push: Record<string, unknown>;
  parameters: Record<string, { type: string; required: boolean; description: string }>;
  platform_mappings: Record<string, string>;
  notes: string | null;
}

export interface DataLayerSpec {
  version: string;
  generated_at: string;
  client: { name: string; website_url: string | null };
  events: DataLayerEvent[];
}

export interface DeliverablesBuildResult {
  gtm_container: Record<string, unknown>;
  datalayer_spec: DataLayerSpec;
}

interface DeployedSignalRow {
  id: string;
  key: string;
  name: string;
  category: string | null;
  required_params: Array<{ key: string; label: string; type: string }> | null;
  optional_params: Array<{ key: string; label: string; type: string }> | null;
  platform_mappings: Record<string, { event_name: string; param_mapping: Record<string, string> }> | null;
}

interface ClientRow {
  name: string;
  website_url: string | null;
}

export async function buildDeliverables(clientId: string): Promise<DeliverablesBuildResult> {
  const [clientResult, signalsResult] = await Promise.all([
    supabaseAdmin
      .from('clients')
      .select('name, website_url')
      .eq('id', clientId)
      .single(),
    fetchDeployedSignals(clientId),
  ]);

  if (clientResult.error) throw new Error(`Client not found: ${clientResult.error.message}`);
  const client = clientResult.data as ClientRow;

  const events = signalsResult.map((signal) => buildEventSpec(signal));
  const gtm_container = buildGtmContainer(client.name, events, signalsResult);

  return {
    gtm_container,
    datalayer_spec: {
      version: '1.0',
      generated_at: new Date().toISOString(),
      client: { name: client.name, website_url: client.website_url },
      events,
    },
  };
}

async function fetchDeployedSignals(clientId: string): Promise<DeployedSignalRow[]> {
  // Get all signal_pack_signals for packs deployed to this client, then join signals
  const { data: deployments, error: dErr } = await supabaseAdmin
    .from('deployments')
    .select('pack_id')
    .eq('client_id', clientId);

  if (dErr) throw new Error(`Failed to fetch deployments: ${dErr.message}`);
  if (!deployments || deployments.length === 0) return [];

  const packIds = deployments.map((d) => d.pack_id as string);

  const { data: packSignals, error: psErr } = await supabaseAdmin
    .from('signal_pack_signals')
    .select('signal_id')
    .in('pack_id', packIds);

  if (psErr) throw new Error(`Failed to fetch pack signals: ${psErr.message}`);
  if (!packSignals || packSignals.length === 0) return [];

  const signalIds = [...new Set(packSignals.map((ps) => ps.signal_id as string))];

  const { data: signals, error: sErr } = await supabaseAdmin
    .from('signals')
    .select('id, key, name, category, required_params, optional_params, platform_mappings')
    .in('id', signalIds);

  if (sErr) throw new Error(`Failed to fetch signals: ${sErr.message}`);
  return (signals ?? []) as DeployedSignalRow[];
}

function buildEventSpec(signal: DeployedSignalRow): DataLayerEvent {
  const allParams: DataLayerEvent['parameters'] = {};

  for (const p of signal.required_params ?? []) {
    allParams[p.key] = { type: p.type ?? 'string', required: true, description: p.label };
  }
  for (const p of signal.optional_params ?? []) {
    allParams[p.key] = { type: p.type ?? 'string', required: false, description: p.label };
  }

  const datalayerPush: Record<string, unknown> = { event: signal.key };
  for (const param of Object.keys(allParams)) {
    datalayerPush[param] = `<${param}>`;
  }

  const platformMappings: Record<string, string> = {};
  for (const [platform, mapping] of Object.entries(signal.platform_mappings ?? {})) {
    platformMappings[platform] = mapping.event_name;
  }

  return {
    signal_key: signal.key,
    event_name: signal.name,
    trigger: inferTrigger(signal.category),
    datalayer_push: datalayerPush,
    parameters: allParams,
    platform_mappings: platformMappings,
    notes: null,
  };
}

function inferTrigger(category: string | null): string {
  switch (category) {
    case 'purchase': return 'Page view — order confirmation URL';
    case 'lead': return 'Form submission success';
    case 'page_view': return 'All pages';
    case 'scroll': return 'Scroll depth event';
    case 'click': return 'Element click event';
    case 'video': return 'Video progress event';
    default: return 'Custom event';
  }
}

function buildGtmContainer(
  clientName: string,
  events: DataLayerEvent[],
  signals: DeployedSignalRow[],
): Record<string, unknown> {
  const tags = events.map((ev, i) => ({
    name: `Atlas - ${ev.event_name}`,
    type: 'gaawe',
    parameter: [
      { type: 'template', key: 'eventName', value: ev.signal_key },
      {
        type: 'list',
        key: 'eventParameters',
        list: Object.keys(ev.parameters).map((key) => ({
          type: 'map',
          map: [
            { type: 'template', key: 'name', value: key },
            { type: 'template', key: 'value', value: `{{DL - ${key}}}` },
          ],
        })),
      },
    ],
    firingTriggerId: [`trigger_${i}`],
  }));

  const variables = signals.flatMap((signal) =>
    [...(signal.required_params ?? []), ...(signal.optional_params ?? [])].map((p) => ({
      name: `DL - ${p.key}`,
      type: 'v',
      parameter: [
        { type: 'integer', key: 'dataLayerVersion', value: '2' },
        { type: 'boolean', key: 'setDefaultValue', value: 'false' },
        { type: 'template', key: 'name', value: p.key },
      ],
    })),
  );

  const triggers = events.map((ev, i) => ({
    name: `Atlas - ${ev.event_name} trigger`,
    type: 'customEvent',
    parameter: [{ type: 'template', key: 'customEventFilter', value: ev.signal_key }],
    uniqueTriggerId: `trigger_${i}`,
  }));

  return {
    exportFormatVersion: 2,
    exportTime: new Date().toISOString(),
    containerVersion: {
      path: `accounts/0/containers/0/versions/0`,
      accountId: '0',
      containerId: '0',
      containerVersionId: '0',
      name: `Atlas - ${clientName}`,
      description: `Generated by Atlas for ${clientName}`,
      container: {
        path: 'accounts/0/containers/0',
        accountId: '0',
        containerId: '0',
        name: `Atlas - ${clientName}`,
        usageContext: ['WEB'],
      },
      tag: tags,
      trigger: triggers,
      variable: variables,
    },
  };
}
