/**
 * Rules for the IHC rules worker: the 14 tag_configuration rules plus the 4
 * Google Tag Topology rules (Sprint 3) = 18.
 *
 * The topology rules live here, not in tagConfiguration.ts's
 * TAG_CONFIGURATION_RULES_ALL, because that array also feeds the legacy v1
 * audit engine (validation/engine.ts), whose scorer counts skipped results
 * in its denominator — see the note in tagConfiguration.ts.
 */
import { TAG_CONFIGURATION_RULES_ALL } from '@/services/validation/tagConfiguration';
import { GOOGLE_TAG_TOPOLOGY_RULES } from '@/services/validation/googleTagTopology';

export const TAG_CONFIGURATION_RULES = [...TAG_CONFIGURATION_RULES_ALL, ...GOOGLE_TAG_TOPOLOGY_RULES];
