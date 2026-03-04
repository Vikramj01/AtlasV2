import type {
  ValidationSpec,
  StageValidationSpec,
  ExpectedEvent,
  ExpectedPlatform,
  GlobalCheck,
  JourneyDefinition,
  PlatformConfig,
  Platform,
} from '../../../types/journey';
import { getActionPrimitive } from '../actionPrimitives';
import { getPlatformSchema } from '../platformSchemas';

function buildExpectedEvents(actions: string[], activePlatforms: Platform[]): ExpectedEvent[] {
  const events: ExpectedEvent[] = [];

  for (const actionKey of actions) {
    if (actionKey === 'ad_landing') continue;

    const primitive = getActionPrimitive(actionKey);
    if (!primitive) continue;

    const eventNameByPlatform: Record<string, string> = {};
    for (const pm of primitive.platform_mappings) {
      if (activePlatforms.includes(pm.platform)) {
        eventNameByPlatform[pm.platform] = pm.event_name;
      }
    }

    if (Object.keys(eventNameByPlatform).length === 0) continue;

    events.push({
      action_key: actionKey,
      event_name_by_platform: eventNameByPlatform,
      required_params: primitive.required_params.map((p) => p.key),
      optional_params: primitive.optional_params.map((p) => p.key),
    });
  }

  return events;
}

function buildExpectedPlatforms(activePlatforms: Platform[]): ExpectedPlatform[] {
  return activePlatforms.map((platform) => {
    const schema = getPlatformSchema(platform);
    return {
      platform,
      must_detect_tag: schema?.delivery.method !== 'server_side',
      must_receive_event: schema?.delivery.endpoint_patterns.length ? true : false,
      endpoint_patterns: schema?.delivery.endpoint_patterns || [],
    };
  });
}

function buildGlobalChecks(platforms: Platform[]): GlobalCheck[] {
  const checks: GlobalCheck[] = [];

  for (const platform of platforms) {
    const schema = getPlatformSchema(platform);
    if (!schema?.click_id) continue;

    checks.push({
      check_type: 'click_id_persistence',
      platform,
      description: `${schema.click_id.param_name} captured on landing page must persist to conversion page via ${schema.click_id.cookie_name || 'cookie'}`,
      params: {
        param_name: schema.click_id.param_name,
        storage_method: schema.click_id.storage_method,
        cookie_name: schema.click_id.cookie_name,
      },
    });
  }

  checks.push({
    check_type: 'event_id_deduplication',
    platform: 'all',
    description: 'event_id must be consistent between client-side dataLayer and server-side GTM for deduplication',
    params: {},
  });

  const hashingPlatforms = platforms.filter((p) => {
    const schema = getPlatformSchema(p);
    return schema?.user_data_handling.hashing_required;
  });

  if (hashingPlatforms.length > 0) {
    checks.push({
      check_type: 'pii_hashing',
      platform: hashingPlatforms.join(','),
      description: 'User email and phone must be SHA-256 hashed before being sent to ad platforms',
      params: { platforms: hashingPlatforms, fields: ['user_email', 'user_phone'] },
    });
  }

  return checks;
}

export function generateValidationSpec(journey: JourneyDefinition, platforms: PlatformConfig[]): ValidationSpec {
  const activePlatforms = platforms.filter((p) => p.is_active).map((p) => p.platform);

  const stages: StageValidationSpec[] = journey.stages
    .sort((a, b) => a.stage_order - b.stage_order)
    .map((stage) => ({
      stage_order: stage.stage_order,
      stage_label: stage.label,
      sample_url: stage.sample_url,
      expected_events: buildExpectedEvents(stage.actions, activePlatforms),
      expected_platforms: buildExpectedPlatforms(activePlatforms),
    }));

  return {
    journey_id: journey.id,
    stages,
    global_checks: buildGlobalChecks(activePlatforms),
  };
}
