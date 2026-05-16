/**
 * Re-exports the tag_configuration rules for the IHC rules worker.
 *
 * The worker imports this module dynamically so it can start cleanly
 * before any rules are deployed. Add Phase B rules here when Sprint B ships.
 */
export { TAG_CONFIGURATION_RULES_PHASE_A as TAG_CONFIGURATION_RULES } from '@/services/validation/tagConfiguration';
