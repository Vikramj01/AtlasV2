/**
 * Attribution Chain Check PRD §6/§9 — "the same absence-is-not-certainty
 * discipline that governs report copy applies here, and outputLint.ts must
 * be run over the new copy." reporting/outputLint.ts's own lintReportOutput()
 * is hard-wired to the Audit Engine's ReportJSON shape, which Campaign
 * Signal Validator's PDF/result-page copy isn't, so this reuses its single
 * BANNED_TOKENS source of truth against plain strings instead of
 * maintaining a second, potentially-drifting list.
 */
import { BANNED_TOKENS } from '@/services/reporting/outputLint';

export interface ChainCopyViolation {
  text: string;
  token: string;
}

/** Returns every banned-token occurrence across the given copy strings — [] when clean. */
export function lintChainCopy(texts: string[]): ChainCopyViolation[] {
  const violations: ChainCopyViolation[] = [];
  for (const text of texts) {
    const lower = text.toLowerCase();
    for (const token of BANNED_TOKENS) {
      if (lower.includes(token.toLowerCase())) {
        violations.push({ text, token });
      }
    }
  }
  return violations;
}
