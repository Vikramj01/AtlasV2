/**
 * objectMapper — CRM object/stage → Atlas event name.
 * docs/prd/crm-outcome-integration.md §4.1.
 *
 * Two jobs, both pure:
 *   - buildDefaultStageMappings(): seeds a sensible default ladder from a
 *     connected pipeline's stages, for the StageLadderEditor to pre-fill
 *     and the operator to review/correct before saving — never persisted
 *     directly.
 *   - resolveStageMapping(): given a config's saved ladder, finds which
 *     (enabled) mapping a raw incoming crm_stage_id resolves to. Returns
 *     null for a stage the operator hasn't mapped — the caller (Sprint 4's
 *     orchestrator) treats that as "no conversion for this stage change",
 *     not an error.
 */

import type { CrmPipeline } from './sources/types';
import type { StageMappingInput } from '@/types/outcomes';

function slugifyStageLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'stage';
}

export function buildDefaultStageMappings(pipeline: CrmPipeline): StageMappingInput[] {
  return pipeline.stages
    .slice()
    .sort((a, b) => a.display_order - b.display_order)
    .map((stage) => {
      const isClosed = stage.metadata?.is_closed ?? false;
      const probability = stage.metadata?.probability ?? null;
      const isWon = isClosed && probability !== null && probability >= 1;
      const isLost = isClosed && probability !== null && probability <= 0;

      return {
        crm_stage_id: stage.id,
        crm_stage_label: stage.label,
        stage_order: stage.display_order,
        atlas_event_name: isWon ? 'crm_closed_won' : isLost ? 'crm_closed_lost' : `crm_${slugifyStageLabel(stage.label)}`,
        is_terminal_won: isWon,
        is_terminal_lost: isLost,
        enabled: true,
      };
    });
}

export function resolveStageMapping<T extends { crm_stage_id: string; enabled: boolean }>(
  mappings: T[],
  stageId: string,
): T | null {
  return mappings.find((m) => m.enabled && m.crm_stage_id === stageId) ?? null;
}
