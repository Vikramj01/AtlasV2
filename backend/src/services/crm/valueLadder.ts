/**
 * valueLadder — stage → conversion value resolution.
 * docs/prd/crm-outcome-integration.md §7.
 *
 * Pure function. Resolution order, independent of value_mode:
 *   1. CRM_AMOUNT (§7.2) — a terminal-won stage with a real observed deal
 *      amount always wins; it's the only genuinely observed value in the
 *      whole ladder. No currency conversion — deliver in the record's own
 *      currency, falling back to the config's default_currency only when
 *      the provider exposes none.
 *   2. DERIVED (§7.3) — only when value_mode is 'DERIVED' and the caller
 *      supplies a non-'withheld' derivedValueCalculator.ts result (Sprint
 *      7 — always null until then, so this branch is currently inert by
 *      construction, not by a flag).
 *   3. DECLARED (§7.1) — the operator-set per-stage value. Also the cold-
 *      start / withheld fallback for DERIVED mode, per §7.3's requirement
 *      that DERIVED "must degrade to DECLARED cleanly."
 *   4. NONE — nothing to deliver a value for; outcomeDelivery.ts (Sprint 5)
 *      still delivers the conversion itself, just without a value.
 */

import type { CrmStageMapping, CrmSyncConfig } from '@/types/crm';

export type ValueSource = 'DECLARED' | 'DERIVED' | 'CRM_AMOUNT' | 'NONE';
export type DerivedConfidence = 'high' | 'low' | 'withheld';

export interface ValueResolution {
  value: number | null;
  currency: string | null;
  value_source: ValueSource;
  derived_confidence: DerivedConfidence | null;
}

export interface ObservedCrmAmount {
  amount: number | null;
  currency: string | null;
}

export interface DerivedValueInput {
  value: number;
  currency: string;
  confidence: DerivedConfidence;
}

export function resolveValue(
  mapping: Pick<CrmStageMapping, 'is_terminal_won' | 'declared_value' | 'currency'>,
  config: Pick<CrmSyncConfig, 'value_mode' | 'default_currency'>,
  observed?: ObservedCrmAmount | null,
  derived?: DerivedValueInput | null,
): ValueResolution {
  if (mapping.is_terminal_won && observed?.amount != null) {
    return {
      value: observed.amount,
      currency: observed.currency ?? config.default_currency,
      value_source: 'CRM_AMOUNT',
      derived_confidence: null,
    };
  }

  if (config.value_mode === 'DERIVED' && derived && derived.confidence !== 'withheld') {
    return {
      value: derived.value,
      currency: derived.currency,
      value_source: 'DERIVED',
      derived_confidence: derived.confidence,
    };
  }

  if (mapping.declared_value != null) {
    return {
      value: mapping.declared_value,
      currency: mapping.currency ?? config.default_currency,
      value_source: 'DECLARED',
      derived_confidence: null,
    };
  }

  return {
    value: null,
    currency: null,
    value_source: 'NONE',
    derived_confidence: derived?.confidence ?? null,
  };
}
