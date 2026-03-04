import type { WalkerOSOutput, WalkerOSTagOutput, JourneyDefinition, PlatformConfig } from '../../../types/journey';
import { getActionPrimitive } from '../actionPrimitives';

const WALKEROS_EVENT_MAP: Record<string, string> = {
  purchase: 'product action',
  add_to_cart: 'product add',
  begin_checkout: 'order start',
  generate_lead: 'lead submit',
  sign_up: 'user register',
  view_item: 'product view',
  view_item_list: 'product list',
  search: 'search query',
  ad_landing: 'page view',
};

function buildDestinationMapping(platform: string, actions: string[]): Record<string, unknown> {
  const mapping: Record<string, unknown> = {};

  for (const actionKey of actions) {
    const walkerosEvent = WALKEROS_EVENT_MAP[actionKey];
    if (!walkerosEvent) continue;

    const primitive = getActionPrimitive(actionKey);
    if (!primitive) continue;

    const platformMapping = primitive.platform_mappings.find((m) => m.platform === platform);
    if (!platformMapping) continue;

    if (actionKey === 'purchase') {
      if (platform === 'ga4') {
        mapping[walkerosEvent] = {
          name: 'purchase',
          data: { transaction_id: 'data.transaction_id', value: 'data.value', currency: 'data.currency', items: 'data.items' },
        };
      } else if (platform === 'meta') {
        mapping[walkerosEvent] = {
          name: 'Purchase',
          data: { value: 'data.value', currency: 'data.currency', content_ids: 'data.items.*.item_id', content_type: 'product' },
        };
      } else if (platform === 'google_ads') {
        mapping[walkerosEvent] = {
          name: 'conversion',
          data: { value: 'data.value', currency: 'data.currency', transaction_id: 'data.transaction_id', send_to: '{{GOOGLE_ADS_CONVERSION_ID}}/{{CONVERSION_LABEL}}' },
        };
      }
    } else if (actionKey === 'add_to_cart') {
      if (platform === 'ga4') {
        mapping[walkerosEvent] = {
          name: 'add_to_cart',
          data: { value: 'data.value', currency: 'data.currency', items: 'data.items' },
        };
      } else if (platform === 'meta') {
        mapping[walkerosEvent] = {
          name: 'AddToCart',
          data: { value: 'data.value', currency: 'data.currency', content_ids: 'data.items.*.item_id', content_type: 'product' },
        };
      }
    } else if (actionKey === 'generate_lead') {
      if (platform === 'ga4') {
        mapping[walkerosEvent] = { name: 'generate_lead', data: { form_id: 'data.form_id', value: 'data.value', currency: 'data.currency' } };
      } else if (platform === 'meta') {
        mapping[walkerosEvent] = { name: 'Lead', data: { value: 'data.value', currency: 'data.currency' } };
      }
    } else if (actionKey === 'sign_up') {
      if (platform === 'ga4') {
        mapping[walkerosEvent] = { name: 'sign_up', data: { method: 'data.method' } };
      } else if (platform === 'meta') {
        mapping[walkerosEvent] = { name: 'CompleteRegistration', data: { content_name: 'data.method', status: 'true' } };
      }
    }
  }

  return mapping;
}

function buildDestinations(journey: JourneyDefinition, platforms: PlatformConfig[]): Record<string, unknown> {
  const allActions = [...new Set(journey.stages.flatMap((s) => s.actions))];
  const destinations: Record<string, unknown> = {};

  for (const pc of platforms) {
    if (!pc.is_active) continue;

    const measurementId = pc.measurement_id;
    const config: Record<string, unknown> = {};

    if (pc.platform === 'ga4') config['measurement_id'] = measurementId || 'G-XXXXXXXXX';
    else if (pc.platform === 'meta') config['pixel_id'] = measurementId || '{{META_PIXEL_ID}}';
    else if (pc.platform === 'google_ads') config['conversion_id'] = measurementId || '{{GOOGLE_ADS_CONVERSION_ID}}';
    else if (pc.platform === 'sgtm') config['transport_url'] = measurementId || '{{SGTM_ENDPOINT_URL}}';
    else if (pc.platform === 'tiktok') config['pixel_id'] = measurementId || '{{TIKTOK_PIXEL_ID}}';
    else if (pc.platform === 'linkedin') config['partner_id'] = measurementId || '{{LINKEDIN_PARTNER_ID}}';

    const consent: Record<string, boolean> = {};
    if (['ga4', 'sgtm'].includes(pc.platform)) consent['functional'] = true;
    else consent['marketing'] = true;

    destinations[pc.platform] = {
      package: `@walkeros/destination-${pc.platform.replace('_', '-')}`,
      config,
      consent,
      mapping: buildDestinationMapping(pc.platform, allActions),
    };
  }

  return destinations;
}

function generateStageTagging(
  stageLabel: string,
  stageOrder: number,
  sampleUrl: string | null,
  actions: string[],
): WalkerOSTagOutput {
  const lines: string[] = [];

  lines.push(`<!-- Stage: ${stageLabel} -->`);
  if (sampleUrl) lines.push(`<!-- URL: ${sampleUrl} -->`);
  lines.push('');

  if (actions.length === 0 || (actions.length === 1 && actions[0] === 'ad_landing')) {
    lines.push('<!-- No specific tagging required for this stage. -->');
    lines.push('<!-- WalkerOS will auto-track page_view via the web source. -->');
  } else {
    for (const actionKey of actions) {
      if (actionKey === 'ad_landing') continue;
      const walkerosEvent = WALKEROS_EVENT_MAP[actionKey] || actionKey;
      lines.push(`<!-- Trigger the "${walkerosEvent}" event using elb() or data attributes -->`);
      lines.push('');
      lines.push(`<!-- Option A: JavaScript call -->`);
      lines.push(`<script>`);
      lines.push(`  // Call when this action occurs on the page`);
      lines.push(`  elb('${walkerosEvent}', {`);
      lines.push(`    // Add relevant data properties here`);
      lines.push(`    // See Atlas-generated dataLayer spec for required fields`);
      lines.push(`  });`);
      lines.push(`</script>`);
      lines.push('');
      lines.push(`<!-- Option B: HTML data attributes (declarative) -->`);
      lines.push(`<button`);
      lines.push(`  data-elb="${walkerosEvent.split(' ')[0]}"`);
      lines.push(`  data-elb-${walkerosEvent.split(' ')[0]}="action:${walkerosEvent.split(' ')[1] || 'trigger'}"`);
      lines.push(`  data-elbaction="click:${walkerosEvent}"`);
      lines.push(`>`);
      lines.push(`  <!-- Your button content -->`);
      lines.push(`</button>`);
      lines.push('');
    }
  }

  return {
    stage_label: stageLabel,
    stage_order: stageOrder,
    sample_url: sampleUrl,
    tagging_method: 'elb_calls',
    code_snippet: lines.join('\n'),
    comments: [],
  };
}

const WALKEROS_README = `# WalkerOS Integration Setup

## Installation

\`\`\`bash
npm install @elbwalker/walker.js
\`\`\`

## Quick Start

1. Load the walker.js script in your HTML \`<head>\`:
\`\`\`html
<script src="https://cdn.jsdelivr.net/npm/@elbwalker/walker.js/dist/walker.js"></script>
\`\`\`

2. Copy \`flow.json\` from this package to your project.

3. Initialize WalkerOS with the provided flow configuration:
\`\`\`javascript
import { Walkerjs } from '@elbwalker/walker.js';
import flowConfig from './flow.json';

const walker = Walkerjs(flowConfig);
\`\`\`

4. Add the HTML data attributes or elb() calls from each stage file to your pages.

## Destination Packages

Install the destination packages for each platform:
\`\`\`bash
npm install @walkeros/destination-ga4
npm install @walkeros/destination-meta
# etc.
\`\`\`

## Configuration

Replace all placeholder values in \`flow.json\` with your actual IDs:
- \`G-XXXXXXXXX\` → Your GA4 Measurement ID
- \`{{META_PIXEL_ID}}\` → Your Meta Pixel ID
- \`{{GOOGLE_ADS_CONVERSION_ID}}\` → Your Google Ads Conversion ID

## Support

Generated by Atlas Signal Health Platform. For WalkerOS documentation, see https://www.elbwalker.com/docs
`;

export function generateWalkerOSFlow(journey: JourneyDefinition, platforms: PlatformConfig[]): WalkerOSOutput {
  const flowJson = {
    version: '1.0',
    sources: {
      web: {
        default: true,
        consent: {
          functional: { required: true },
          marketing: { required: false },
        },
      },
    },
    destinations: buildDestinations(journey, platforms),
  };

  const elbTags: WalkerOSTagOutput[] = journey.stages
    .sort((a, b) => a.stage_order - b.stage_order)
    .map((stage) =>
      generateStageTagging(stage.label, stage.stage_order, stage.sample_url, stage.actions),
    );

  return { flow_json: flowJson, elb_tags: elbTags, readme: WALKEROS_README };
}
