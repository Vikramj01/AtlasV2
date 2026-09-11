/**
 * Click-ID Contention (Click-ID Contention, Contradiction Guard & Settle
 * Enforcement PRD W1 — minimum option).
 *
 * journeySimulator.ts's makeSyntheticIds() injects all seven click IDs onto
 * the landing URL in a single pass, so a family with more than one member
 * (Google: gclid/gbraid/wbraid) never reflects a realistic single-click
 * visit — a real visit carries exactly one click ID. When the site's own
 * conversion linker is presented with gclid, gbraid and wbraid
 * simultaneously, it resolves the conflict and writes one, which is
 * correct behaviour on the site's part, not a capture failure. The
 * reference audit (7d64f5e9, birkenstock.com/sg) is exactly this: gclid
 * captured (via _gcl_ls), gbraid and wbraid failed — the site was never
 * given a realistic input to fail on.
 *
 * This only fires when the family has a genuine winner: at least one
 * member captured and at least one not. If every member of a contended
 * family failed to capture, there's no linker resolution to blame — that's
 * a real capture failure with nothing here to explain it away.
 *
 * Contention only applies within a family (§2.3) — gclid and ttclid
 * arriving together is unrealistic but not conflicting, so it's excluded
 * by construction (each family here has its own entry, and Meta/TikTok/
 * Microsoft/LinkedIn/OpenAI are all single-member families — OpenAI's
 * oppref shares no linker cookie with any Google/Meta/TikTok identifier,
 * per ATLAS_OPENAI_ADS_AND_REGIONS_PRD A-W4).
 */
import type { AuditData, UnassessableFinding, ValidationResult } from '@/types/audit';
import logger from '@/utils/logger';

/** Platform families whose click IDs are mutually exclusive in reality (PRD §2.3). */
const CLICK_ID_FAMILIES: Record<string, string[]> = {
  google: ['gclid', 'gbraid', 'wbraid'],
  meta: ['fbclid'],
  tiktok: ['ttclid'],
  microsoft: ['msclkid'],
  linkedin: ['li_fat_id'],
  openai: ['oppref'],
};

const PARAM_TO_CAPTURE_RULE_ID: Record<string, string> = {
  gclid: 'GCLID_CAPTURED_AT_LANDING',
  gbraid: 'GBRAID_CAPTURED_AT_LANDING',
  wbraid: 'WBRAID_CAPTURED_AT_LANDING',
  fbclid: 'FBCLID_CAPTURED_AT_LANDING',
  ttclid: 'TTCLID_CAPTURED_AT_LANDING',
  msclkid: 'MSCLKID_CAPTURED_AT_LANDING',
  li_fat_id: 'LI_FAT_ID_CAPTURED_AT_LANDING',
  oppref: 'OPPREF_CAPTURED_AT_LANDING',
};

export interface ClickIdContentionPartition {
  assessable: ValidationResult[];
  unassessable: UnassessableFinding[];
}

function paramLabel(param: string): string {
  return param;
}

/**
 * Detects, per family, whether more than one member was actually injected
 * on this run and — among those — which capture-rule results are
 * contention losers (failed to capture while a sibling in the same family
 * did). Returns the set of rule_ids affected.
 */
function contendedRuleIds(
  results: ValidationResult[],
  auditData: Pick<AuditData, 'urlParams'>,
): Set<string> {
  const byRuleId = new Map(results.map((r) => [r.rule_id, r]));
  const contended = new Set<string>();

  for (const members of Object.values(CLICK_ID_FAMILIES)) {
    const injected = members.filter((m) => !!auditData.urlParams?.[m]);
    if (injected.length < 2) continue; // no contention possible — only one (or zero) family member sent

    const memberOutcomes = injected
      .map((param) => ({ param, result: byRuleId.get(PARAM_TO_CAPTURE_RULE_ID[param]) }))
      .filter((m): m is { param: string; result: ValidationResult } => !!m.result);

    const captured = memberOutcomes.filter((m) => m.result.status === 'pass');
    const notCaptured = memberOutcomes.filter((m) => m.result.status === 'fail');

    // A winner (captured) plus at least one loser (not captured) is
    // exactly the contention shape — nothing to fall back on when either
    // side is empty (all captured: no contradiction to explain; none
    // captured: a real failure, not resolved by contention).
    if (captured.length === 0 || notCaptured.length === 0) continue;

    for (const m of notCaptured) contended.add(m.result.rule_id);
  }

  return contended;
}

export function partitionClickIdContention(
  results: ValidationResult[],
  auditData: Pick<AuditData, 'urlParams'>,
): ClickIdContentionPartition {
  const contended = contendedRuleIds(results, auditData);
  if (contended.size === 0) return { assessable: results, unassessable: [] };

  logger.warn(
    { rule_ids: [...contended] },
    'Click-ID contention detected — multiple family members injected in one pass; contended results routed to could_not_be_assessed rather than scored as CRITICAL fails',
  );

  const assessable: ValidationResult[] = [];
  const unassessable: UnassessableFinding[] = [];

  for (const r of results) {
    if (!contended.has(r.rule_id)) {
      assessable.push(r);
      continue;
    }
    const param = Object.entries(PARAM_TO_CAPTURE_RULE_ID).find(([, ruleId]) => ruleId === r.rule_id)?.[0] ?? r.rule_id;
    unassessable.push({
      rule_id: r.rule_id,
      step: 'landing',
      reason: `This scan injected more than one click ID from the same platform family at once (a condition that never occurs on a real visit) and the site's own conversion linker resolved the conflict in favour of a different family member. This does not mean ${paramLabel(param)} capture is broken — it means this run's synthetic input couldn't isolate it. A single-identifier re-test would give a conclusive result.`,
      // Pre-Connection Scan Confidence Tiering PRD §4.3 — two independent
      // family members disagreeing about which one "really" captured is
      // exactly a CONFLICT, not a coverage gap (NOT_OBSERVED).
      kind: 'CONFLICT',
    });
  }

  return { assessable, unassessable };
}
