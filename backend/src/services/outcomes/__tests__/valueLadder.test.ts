import { describe, it, expect } from 'vitest';
import { resolveValue } from '../valueLadder';

const declaredConfig = { value_mode: 'DECLARED' as const, default_currency: 'USD' };
const derivedConfig = { value_mode: 'DERIVED' as const, default_currency: 'USD' };

describe('resolveValue', () => {
  it('DECLARED mode uses the mapping declared_value and its own currency', () => {
    const mapping = { is_terminal_won: false, declared_value: 500, currency: 'GBP' };
    const result = resolveValue(mapping, declaredConfig);
    expect(result).toEqual({ value: 500, currency: 'GBP', value_source: 'DECLARED', derived_confidence: null });
  });

  it('DECLARED mode falls back to the config default_currency when the mapping has none', () => {
    const mapping = { is_terminal_won: false, declared_value: 500, currency: null };
    const result = resolveValue(mapping, declaredConfig);
    expect(result.currency).toBe('USD');
  });

  it('resolves to NONE when no declared value and not terminal-won with an observed amount', () => {
    const mapping = { is_terminal_won: false, declared_value: null, currency: null };
    const result = resolveValue(mapping, declaredConfig);
    expect(result).toEqual({ value: null, currency: null, value_source: 'NONE', derived_confidence: null });
  });

  it('CRM_AMOUNT wins on a terminal-won stage with a real observed amount, overriding DECLARED', () => {
    const mapping = { is_terminal_won: true, declared_value: 100, currency: 'USD' };
    const result = resolveValue(mapping, declaredConfig, { amount: 4200, currency: 'AED' });
    expect(result).toEqual({ value: 4200, currency: 'AED', value_source: 'CRM_AMOUNT', derived_confidence: null });
  });

  it('CRM_AMOUNT never converts currency — falls back to config default only when the record has none', () => {
    const mapping = { is_terminal_won: true, declared_value: null, currency: null };
    const result = resolveValue(mapping, declaredConfig, { amount: 4200, currency: null });
    expect(result.currency).toBe('USD');
    expect(result.value).toBe(4200);
  });

  it('a terminal-won stage with no observed amount falls through to DECLARED, not CRM_AMOUNT', () => {
    const mapping = { is_terminal_won: true, declared_value: 900, currency: 'USD' };
    const result = resolveValue(mapping, declaredConfig, { amount: null, currency: null });
    expect(result.value_source).toBe('DECLARED');
    expect(result.value).toBe(900);
  });

  it('DERIVED mode uses a high-confidence derived value over DECLARED', () => {
    const mapping = { is_terminal_won: false, declared_value: 100, currency: 'USD' };
    const result = resolveValue(mapping, derivedConfig, null, { value: 275, currency: 'USD', confidence: 'high' });
    expect(result).toEqual({ value: 275, currency: 'USD', value_source: 'DERIVED', derived_confidence: 'high' });
  });

  it('DERIVED mode with a withheld confidence degrades cleanly to DECLARED (§7.3 cold start)', () => {
    const mapping = { is_terminal_won: false, declared_value: 150, currency: 'USD' };
    const result = resolveValue(mapping, derivedConfig, null, { value: 999, currency: 'USD', confidence: 'withheld' });
    expect(result.value_source).toBe('DECLARED');
    expect(result.value).toBe(150);
  });

  it('DERIVED mode with no derived value yet (cold start) and no declared fallback resolves to NONE', () => {
    const mapping = { is_terminal_won: false, declared_value: null, currency: null };
    const result = resolveValue(mapping, derivedConfig, null, null);
    expect(result.value_source).toBe('NONE');
  });

  it('CRM_AMOUNT still wins over a DERIVED value on a terminal-won stage', () => {
    const mapping = { is_terminal_won: true, declared_value: null, currency: null };
    const result = resolveValue(
      mapping,
      derivedConfig,
      { amount: 3000, currency: 'USD' },
      { value: 275, currency: 'USD', confidence: 'high' },
    );
    expect(result.value_source).toBe('CRM_AMOUNT');
    expect(result.value).toBe(3000);
  });
});
