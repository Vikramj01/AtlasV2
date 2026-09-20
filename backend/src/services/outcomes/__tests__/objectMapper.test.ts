import { describe, it, expect } from 'vitest';
import { buildDefaultStageMappings, resolveStageMapping } from '../objectMapper';
import type { CrmPipeline } from '../sources/types';

describe('buildDefaultStageMappings', () => {
  it('slugifies open-stage labels into crm_-prefixed event names', () => {
    const pipeline: CrmPipeline = {
      id: 'default',
      label: 'Sales Pipeline',
      stages: [
        { id: 'appointmentscheduled', label: 'Appointment Scheduled', display_order: 0 },
        { id: 'qualifiedtobuy', label: 'Qualified To Buy', display_order: 1 },
      ],
    };

    const draft = buildDefaultStageMappings(pipeline);

    expect(draft[0]).toMatchObject({
      crm_stage_id: 'appointmentscheduled',
      atlas_event_name: 'crm_appointment_scheduled',
      is_terminal_won: false,
      is_terminal_lost: false,
      enabled: true,
    });
    expect(draft[1].atlas_event_name).toBe('crm_qualified_to_buy');
  });

  it('marks a closed stage with probability 1.0 as terminal-won', () => {
    const pipeline: CrmPipeline = {
      id: 'default',
      label: 'Sales Pipeline',
      stages: [
        { id: 'closedwon', label: 'Closed Won', display_order: 2, metadata: { is_closed: true, probability: 1 } },
      ],
    };

    const draft = buildDefaultStageMappings(pipeline);

    expect(draft[0].is_terminal_won).toBe(true);
    expect(draft[0].is_terminal_lost).toBe(false);
    expect(draft[0].atlas_event_name).toBe('crm_closed_won');
  });

  it('marks a closed stage with probability 0.0 as terminal-lost', () => {
    const pipeline: CrmPipeline = {
      id: 'default',
      label: 'Sales Pipeline',
      stages: [
        { id: 'closedlost', label: 'Closed Lost', display_order: 3, metadata: { is_closed: true, probability: 0 } },
      ],
    };

    const draft = buildDefaultStageMappings(pipeline);

    expect(draft[0].is_terminal_lost).toBe(true);
    expect(draft[0].is_terminal_won).toBe(false);
    expect(draft[0].atlas_event_name).toBe('crm_closed_lost');
  });

  it('sorts stages by display_order regardless of input order', () => {
    const pipeline: CrmPipeline = {
      id: 'default',
      label: 'Sales Pipeline',
      stages: [
        { id: 'b', label: 'Second', display_order: 1 },
        { id: 'a', label: 'First', display_order: 0 },
      ],
    };

    const draft = buildDefaultStageMappings(pipeline);

    expect(draft.map((d) => d.crm_stage_id)).toEqual(['a', 'b']);
  });
});

describe('resolveStageMapping', () => {
  const mappings = [
    { crm_stage_id: 'a', enabled: true, atlas_event_name: 'crm_a' },
    { crm_stage_id: 'b', enabled: false, atlas_event_name: 'crm_b' },
  ];

  it('resolves an enabled mapping by crm_stage_id', () => {
    expect(resolveStageMapping(mappings, 'a')?.atlas_event_name).toBe('crm_a');
  });

  it('does not resolve a disabled mapping', () => {
    expect(resolveStageMapping(mappings, 'b')).toBeNull();
  });

  it('returns null for a stage the operator has not mapped', () => {
    expect(resolveStageMapping(mappings, 'unmapped_stage')).toBeNull();
  });
});
