/**
 * WalkerOS Composable Generator
 *
 * Generates a modular WalkerOS configuration from deployed signal packs.
 *
 * Output structure:
 *   flow.json         — client-specific config (sources, destinations, imports)
 *   signals/          — per-pack signal definitions (identical across clients)
 *
 * The key advantage: signal pack files are platform-agnostic and shared.
 * Only flow.json is client-specific (it has measurement IDs and destination config).
 * Updating a signal pack → regenerate the pack file → all clients get the update.
 */

import type { ClientWithDetails } from '@/types/organisation';
import type { DeploymentWithSignals } from '@/types/signal';

// ── WalkerOS destination package names ───────────────────────────────────────

const WALKEROS_DESTINATION_PACKAGES: Record<string, string> = {
  ga4: '@walkeros/destination-ga4',
  meta: '@walkeros/destination-meta',
  google_ads: '@walkeros/destination-google-ads',
  tiktok: '@walkeros/destination-tiktok',
  linkedin: '@walkeros/destination-linkedin',
  sgtm: '@walkeros/destination-node',  // Server-side GTM via WalkerOS node destination
};

// ── Build per-pack signal file ────────────────────────────────────────────────

function buildPackSignalFile(deployment: DeploymentWithSignals): Record<string, unknown> {
  return {
    version: '1.0',
    name: deployment.pack_name,
    pack_id: deployment.pack_id,
    events: deployment.signals.map(({ signal }) => ({
      event: signal.key,
      entity: signal.walkeros_mapping?.entity ?? signal.category,
      action: signal.walkeros_mapping?.action ?? signal.key,
      trigger: signal.walkeros_mapping?.trigger ?? { type: 'load' },
      data: {
        required: signal.required_params.map((p) => ({
          key: p.key,
          label: p.label,
          type: p.type,
        })),
        optional: signal.optional_params.map((p) => ({
          key: p.key,
          label: p.label,
          type: p.type,
        })),
      },
      platforms: Object.keys(signal.platform_mappings ?? {}),
    })),
  };
}

// ── Build main flow.json ──────────────────────────────────────────────────────

function buildFlowJson(
  client: ClientWithDetails,
  deployments: DeploymentWithSignals[],
): Record<string, unknown> {
  // Destination configs from client platform measurement IDs
  const destinations: Record<string, unknown> = {};

  for (const platform of client.platforms.filter((p) => p.is_active)) {
    const pkg = WALKEROS_DESTINATION_PACKAGES[platform.platform];
    if (!pkg) continue;

    const config: Record<string, unknown> = {};
    if (platform.platform === 'ga4' && platform.measurement_id) {
      config['measurement_id'] = platform.measurement_id;
    }
    if (platform.platform === 'meta' && platform.measurement_id) {
      config['pixel_id'] = platform.measurement_id;
    }
    if (platform.platform === 'google_ads' && platform.measurement_id) {
      const [id, label] = platform.measurement_id.split('/');
      config['conversion_id'] = id;
      if (label) config['conversion_label'] = label;
    }
    if (platform.platform === 'tiktok' && platform.measurement_id) {
      config['pixel_id'] = platform.measurement_id;
    }
    if (platform.platform === 'sgtm' && platform.measurement_id) {
      config['endpoint'] = platform.measurement_id;
    }
    if (platform.measurement_id && Object.keys(config).length === 0) {
      config['id'] = platform.measurement_id;
    }

    destinations[platform.platform] = { package: pkg, config };
  }

  // Import paths to pack signal files
  const imports = deployments.map((d) => `./signals/${slugify(d.pack_name)}.json`);

  return {
    version: '1.0',
    generated_at: new Date().toISOString(),
    client: client.name,
    website_url: client.website_url,
    sources: {
      web: {
        default: true,
        globals: {
          client_id: client.id,
        },
      },
    },
    imports,
    destinations,
    readme: {
      setup: [
        'npm install @walkeros/walker.js',
        ...Object.values(destinations).map(
          (d) => `npm install ${(d as Record<string, unknown>)['package']}`,
        ),
      ].join('\n'),
      usage: [
        'import { Walkerjs } from "@walkeros/walker.js";',
        'import flow from "./flow.json";',
        '',
        'const walker = Walkerjs({ ...flow });',
        'walker.push("walker run");',
      ].join('\n'),
    },
  };
}

// ── Main entrypoint ───────────────────────────────────────────────────────────

export function generateWalkerOSFlow(
  client: ClientWithDetails,
  deployments: DeploymentWithSignals[],
): Record<string, unknown> {
  const flowJson = buildFlowJson(client, deployments);

  // Embed signal pack files inline as a nested object for storage
  // (In a real file-system scenario these would be separate files)
  const signalFiles: Record<string, unknown> = {};
  for (const deployment of deployments) {
    const key = slugify(deployment.pack_name);
    signalFiles[key] = buildPackSignalFile(deployment);
  }

  return {
    ...flowJson,
    // The signal_files key is Atlas-internal — the download endpoint will
    // split this into separate files when producing the ZIP download.
    signal_files: signalFiles,
  };
}

function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
