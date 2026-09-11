/**
 * Automatic re-scan confirmation tests (Pre-Connection Scan Confidence
 * Tiering PRD §15). Only FAIL→PASS transitions for the same rule_id
 * across two audits for the same site ever write a row, and only ever
 * CONFIRMED — see ruleConfirmationRescan.ts's header for why REFUTED is
 * never auto-written here.
 */
import { describe, it, expect } from 'vitest';
import { detectRescanConfirmations } from '../ruleConfirmationRescan';
import type { ValidationResult } from '@/types/audit';

function makeResult(overrides: Partial<ValidationResult> & { rule_id: string }): ValidationResult {
  return {
    validation_layer: 'foundation_tags',
    status: 'pass',
    severity: 'high',
    technical_details: { found: '', expected: '', evidence: [] },
    ...overrides,
  };
}

const PREVIOUS = { audit_id: 'audit-prev', created_at: '2026-09-01T00:00:00.000Z' };

describe('detectRescanConfirmations', () => {
  it('writes a CONFIRMED/rescan row when a rule failed previously and passes now', () => {
    const previous = { ...PREVIOUS, results: [makeResult({ rule_id: 'GA4_CONFIG_TAG_PRESENT', status: 'fail' })] };
    const current = [makeResult({ rule_id: 'GA4_CONFIG_TAG_PRESENT', status: 'pass' })];
    const confirmations = detectRescanConfirmations('audit-current', current, previous);
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0]).toMatchObject({ audit_id: 'audit-current', rule_id: 'GA4_CONFIG_TAG_PRESENT', outcome: 'CONFIRMED', source: 'rescan' });
    expect(confirmations[0].note).toContain('audit-prev');
  });

  it('does not write when the rule failed both times (nothing new to confirm)', () => {
    const previous = { ...PREVIOUS, results: [makeResult({ rule_id: 'GA4_CONFIG_TAG_PRESENT', status: 'fail' })] };
    const current = [makeResult({ rule_id: 'GA4_CONFIG_TAG_PRESENT', status: 'fail' })];
    expect(detectRescanConfirmations('audit-current', current, previous)).toEqual([]);
  });

  it('does not write for a regression (passed before, fails now) — not this mechanism\'s job', () => {
    const previous = { ...PREVIOUS, results: [makeResult({ rule_id: 'GA4_CONFIG_TAG_PRESENT', status: 'pass' })] };
    const current = [makeResult({ rule_id: 'GA4_CONFIG_TAG_PRESENT', status: 'fail' })];
    expect(detectRescanConfirmations('audit-current', current, previous)).toEqual([]);
  });

  it('does not write when the rule passed both times', () => {
    const previous = { ...PREVIOUS, results: [makeResult({ rule_id: 'GA4_CONFIG_TAG_PRESENT', status: 'pass' })] };
    const current = [makeResult({ rule_id: 'GA4_CONFIG_TAG_PRESENT', status: 'pass' })];
    expect(detectRescanConfirmations('audit-current', current, previous)).toEqual([]);
  });

  it('does not write for a rule absent from the previous run\'s results', () => {
    const previous = { ...PREVIOUS, results: [] };
    const current = [makeResult({ rule_id: 'GA4_CONFIG_TAG_PRESENT', status: 'pass' })];
    expect(detectRescanConfirmations('audit-current', current, previous)).toEqual([]);
  });

  it('never writes REFUTED, even though the type allows it — only CONFIRMED is ever auto-written', () => {
    const previous = { ...PREVIOUS, results: [makeResult({ rule_id: 'A', status: 'fail' }), makeResult({ rule_id: 'B', status: 'pass' })] };
    const current = [makeResult({ rule_id: 'A', status: 'pass' }), makeResult({ rule_id: 'B', status: 'fail' })];
    const confirmations = detectRescanConfirmations('audit-current', current, previous);
    expect(confirmations.every((c) => c.outcome === 'CONFIRMED')).toBe(true);
  });

  it('prefers verdict over raw status when present — a gated NOT_OBSERVED result never counts as a prior FAIL', () => {
    const previous = { ...PREVIOUS, results: [makeResult({ rule_id: 'A', status: 'fail', verdict: 'NOT_OBSERVED' })] };
    const current = [makeResult({ rule_id: 'A', status: 'pass' })];
    expect(detectRescanConfirmations('audit-current', current, previous)).toEqual([]);
  });

  it('prefers verdict over raw status for the current result too — a gated NOT_OBSERVED never counts as a current PASS', () => {
    const previous = { ...PREVIOUS, results: [makeResult({ rule_id: 'A', status: 'fail' })] };
    const current = [makeResult({ rule_id: 'A', status: 'pass', verdict: 'NOT_OBSERVED' })];
    expect(detectRescanConfirmations('audit-current', current, previous)).toEqual([]);
  });

  it('handles multiple rules independently, writing only for the qualifying ones', () => {
    const previous = {
      ...PREVIOUS,
      results: [
        makeResult({ rule_id: 'FIXED', status: 'fail' }),
        makeResult({ rule_id: 'STILL_BROKEN', status: 'fail' }),
        makeResult({ rule_id: 'ALWAYS_OK', status: 'pass' }),
      ],
    };
    const current = [
      makeResult({ rule_id: 'FIXED', status: 'pass' }),
      makeResult({ rule_id: 'STILL_BROKEN', status: 'fail' }),
      makeResult({ rule_id: 'ALWAYS_OK', status: 'pass' }),
    ];
    const confirmations = detectRescanConfirmations('audit-current', current, previous);
    expect(confirmations.map((c) => c.rule_id)).toEqual(['FIXED']);
  });
});
