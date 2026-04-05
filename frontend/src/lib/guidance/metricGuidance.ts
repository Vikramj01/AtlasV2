/**
 * metricGuidance.ts
 *
 * Plain-language interpretation functions for Atlas quantitative metrics.
 * Each function returns a GuidanceResult that the MetricGuidance component renders.
 *
 * Thresholds match those in the PRD (Section 5) and dashboardService.ts.
 */

export type GuidanceSeverity = 'good' | 'warn' | 'critical' | 'neutral';

export interface GuidanceResult {
  summary: string;
  detail: string;
  action?: string;
  severity: GuidanceSeverity;
}

// ── 1. EMQ Score (0–10) ───────────────────────────────────────────────────────

export function emqGuidance(score: number | null): GuidanceResult {
  if (score === null) {
    return {
      severity: 'neutral',
      summary: 'No EMQ data yet.',
      detail: 'Event Match Quality will appear once your Conversion API starts delivering events to Meta.',
    };
  }
  if (score < 6) {
    return {
      severity: 'critical',
      summary: `EMQ of ${score.toFixed(1)} is below the critical threshold of 6.0.`,
      detail:
        'A low EMQ means Meta cannot match most of your conversions to ad clicks, making your campaigns harder to optimise. Common causes: missing email or phone identifiers, no click ID (fbclid), or customer data not being hashed and sent.',
      action: 'Add email, phone, and fbclid to your CAPI payload to improve your score.',
    };
  }
  if (score < 8) {
    return {
      severity: 'warn',
      summary: `EMQ of ${score.toFixed(1)} is improvable.`,
      detail:
        'Scores between 6 and 8 are functional but leave room for improvement. Adding more customer data signals — especially a hashed email or phone number on every conversion event — typically pushes scores above 8.',
      action: 'Review which identifier fields are missing on your highest-volume events.',
    };
  }
  return {
    severity: 'good',
    summary: `EMQ of ${score.toFixed(1)} is strong.`,
    detail:
      'An EMQ above 8 means Meta can accurately attribute most conversions to the correct ad. Your CAPI setup is sending sufficient customer data.',
  };
}

// ── 2. CAPI Delivery Rate (0–100 as percentage) ───────────────────────────────

export function capiDeliveryGuidance(rate: number | null): GuidanceResult {
  if (rate === null) {
    return {
      severity: 'neutral',
      summary: 'No delivery data yet.',
      detail: 'Delivery rate will appear once your Conversion API has processed events.',
    };
  }
  if (rate < 75) {
    return {
      severity: 'critical',
      summary: `Only ${rate}% of conversion events are being delivered.`,
      detail:
        'A delivery rate below 75% means a significant portion of your conversion data is being lost. Check your error log for recurring failures — common causes include expired tokens, incorrect pixel IDs, or missing required fields.',
      action: 'Open the error log and resolve the most frequent failure type.',
    };
  }
  if (rate < 90) {
    return {
      severity: 'warn',
      summary: `Delivery rate of ${rate}% has room for improvement.`,
      detail:
        'Between 75% and 90% is functional but not optimal. Review failed events — these may be recoverable with minor payload adjustments.',
      action: 'Check the error log for patterns in failed events.',
    };
  }
  return {
    severity: 'good',
    summary: `Delivery rate of ${rate}% is strong.`,
    detail:
      'Above 90% delivery means almost all conversion events are reaching the ad platform. Your CAPI setup is healthy.',
  };
}

// ── 3. Signal Coverage (0–100 as percentage) ──────────────────────────────────

export function signalCoverageGuidance(pct: number | null): GuidanceResult {
  if (pct === null) {
    return {
      severity: 'neutral',
      summary: 'No coverage data yet.',
      detail: 'Run an audit to see how much of your planned tracking is firing correctly.',
    };
  }
  if (pct < 50) {
    return {
      severity: 'critical',
      summary: `Signal coverage of ${pct}% — more than half your tracking is missing.`,
      detail:
        'Critical tracking gaps at this level mean key conversion events are not reaching your analytics or ad platforms. Revenue attribution, remarketing audiences, and optimisation signals are all affected.',
      action: 'Run a full tracking audit to identify the missing events.',
    };
  }
  if (pct < 70) {
    return {
      severity: 'warn',
      summary: `Signal coverage of ${pct}% — tracking gaps worth closing.`,
      detail:
        'Between 50% and 70% coverage indicates some tracking is in place but important events are still missing. Closing these gaps will improve attribution accuracy and campaign performance.',
      action: 'Review your Tracking Map and identify undeployed signals.',
    };
  }
  return {
    severity: 'good',
    summary: `Signal coverage of ${pct}% — most key events are tracked.`,
    detail:
      'Above 70% means your core tracking setup is in good shape. Keep an eye on new pages or product areas that may need coverage as the site evolves.',
  };
}

// ── 4. Audit Score (0–100 as percentage) ─────────────────────────────────────

export function auditScoreGuidance(score: number | null): GuidanceResult {
  if (score === null) {
    return {
      severity: 'neutral',
      summary: 'No audit data yet.',
      detail: 'Run your first tracking audit to see your signal health score and active alerts.',
    };
  }
  if (score < 50) {
    return {
      severity: 'critical',
      summary: `Audit score of ${score}% — major tracking issues detected.`,
      detail:
        'A score below 50% indicates significant tracking failures: events missing, parameters incorrect, or persistence broken. Your conversion data is likely unreliable at this level.',
      action: 'Review active alerts and fix critical issues first.',
    };
  }
  if (score < 65) {
    return {
      severity: 'warn',
      summary: `Audit score of ${score}% — functional gaps to address.`,
      detail:
        'Between 50% and 65% means the core tracking is working but has measurable gaps. Addressing these improves data quality and attribution accuracy.',
      action: 'Work through the medium-severity alerts to improve your score.',
    };
  }
  return {
    severity: 'good',
    summary: `Audit score of ${score}% — tracking implementation is healthy.`,
    detail:
      'Above 65% means your tracking setup is passing the majority of validation rules. Aim for 80%+ for best-in-class data quality.',
  };
}

// ── 5. Consent Rate (0–100 as percentage) ────────────────────────────────────

export function consentRateGuidance(rate: number | null): GuidanceResult {
  if (rate === null) {
    return {
      severity: 'neutral',
      summary: 'No consent data yet.',
      detail: 'Consent rate will appear once your banner starts recording visitor decisions.',
    };
  }
  if (rate < 50) {
    return {
      severity: 'warn',
      summary: `Only ${rate}% of visitors are consenting to tracking.`,
      detail:
        'A consent rate below 50% means you\'re losing more than half your signal data. This significantly impacts remarketing audiences, conversion attribution, and CAPI match rates. Review your banner copy and placement — a clear value exchange typically improves opt-in rates.',
      action: 'A/B test your banner copy and consider adjusting the default position.',
    };
  }
  return {
    severity: 'good',
    summary: `Consent rate of ${rate}% — above the critical threshold.`,
    detail:
      'Over 50% of visitors are consenting. Monitor this over time — changes to regulations or browser behaviour can impact consent rates.',
  };
}

// ── 6. Journey Gap Guidance ───────────────────────────────────────────────────

export function journeyGapGuidance(
  criticalCount: number,
  highCount: number,
  totalGaps: number,
): GuidanceResult {
  if (totalGaps === 0) {
    return {
      severity: 'good',
      summary: 'No tracking gaps found in this journey.',
      detail: 'All expected signals are firing correctly across the audited stages.',
    };
  }
  if (criticalCount > 0) {
    return {
      severity: 'critical',
      summary: `${criticalCount} critical gap${criticalCount > 1 ? 's' : ''} detected — conversion data is incomplete.`,
      detail:
        `There are ${totalGaps} total gap${totalGaps > 1 ? 's' : ''} across this journey, including ${criticalCount} critical issue${criticalCount > 1 ? 's' : ''}. Critical gaps typically mean key conversion events are missing entirely, which breaks attribution for this journey.`,
      action: 'Fix critical gaps first — they have the highest business impact.',
    };
  }
  if (highCount > 0) {
    return {
      severity: 'warn',
      summary: `${highCount} high-severity gap${highCount > 1 ? 's' : ''} need attention.`,
      detail:
        `${totalGaps} total gap${totalGaps > 1 ? 's' : ''} found. High-severity issues affect parameter completeness and may cause inaccurate attribution or audience building.`,
      action: 'Address high-severity gaps to improve signal quality.',
    };
  }
  return {
    severity: 'warn',
    summary: `${totalGaps} gap${totalGaps > 1 ? 's' : ''} found — minor issues to clean up.`,
    detail:
      'No critical or high-severity issues, but there are medium or informational gaps worth resolving to maintain data quality.',
  };
}

// ── 7. Implementation Progress (0–100 as percentage) ─────────────────────────

export function implementationProgressGuidance(pct: number | null): GuidanceResult {
  if (pct === null) {
    return {
      severity: 'neutral',
      summary: 'No implementation data yet.',
      detail: 'Share a developer portal link to start tracking implementation progress.',
    };
  }
  if (pct === 100) {
    return {
      severity: 'good',
      summary: 'Implementation is complete.',
      detail:
        'All pages have been marked as implemented. Run an audit to verify the live tracking matches the spec.',
      action: 'Verify Journeys to confirm the live implementation.',
    };
  }
  if (pct < 70) {
    return {
      severity: 'warn',
      summary: `Implementation is ${pct}% complete — follow up with your developer.`,
      detail:
        'Below 70% completion means most pages still need tracking code deployed. Until this is done, your conversion data will be incomplete.',
      action: 'Check which pages are blocked and unblock them.',
    };
  }
  return {
    severity: 'warn',
    summary: `Implementation is ${pct}% complete — nearly there.`,
    detail:
      'Good progress. A few pages still need work before you can run a full audit.',
  };
}
