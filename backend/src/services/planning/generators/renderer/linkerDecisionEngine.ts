/**
 * Attribution infrastructure decision engine — Google Stack Alignment sprint
 * plan, Sprint 5 (C4).
 *
 * Before this sprint, `googleTagArchitecture.ts` emitted a Google Ads
 * Conversion Linker (`gclidw`) tag unconditionally whenever a Google Ads
 * destination was configured, regardless of whether a sitewide Google tag
 * (`googtag`) was already on the page auto-capturing click IDs for its own
 * destinations. Web click-ID capture, cross-domain linking, and
 * server-side-linking are three separate concerns the old single
 * `if (hasGoogleAds)` boolean conflated:
 *
 *   - **Web linker**: capturing gclid/gbraid/wbraid into a first-party
 *     cookie so a later page (e.g. checkout) can still attribute the
 *     conversion. A `googtag` tag firing on every page already does this
 *     for its own configured destinations — a standalone Conversion Linker
 *     is redundant in that case (Google's own guidance: sites already using
 *     the Google tag don't need a separate Conversion Linker tag).
 *   - **Cross-domain linking**: decorating outbound links to a secondary
 *     domain. Kept on the dedicated Conversion Linker tag regardless of
 *     Google tag presence — this sandbox has no verified live-export
 *     confirmation that `googtag`'s own `linked_domains` config reaches
 *     parity with the Conversion Linker's `enableCrossDomainLinking`/
 *     `domains` behaviour, so the conservative choice is to keep emitting
 *     it rather than risk a silent cross-domain attribution gap.
 *   - **Server-side linker**: when traffic routes through a verified sGTM
 *     endpoint, the server container needs the client-side click-ID cookie
 *     in the specific shape it expects. Not confirmed to be something the
 *     `googtag` tag's own `enableSendToServerContainer` flag alone
 *     guarantees — kept as its own always-emit case.
 *   - **Floodlight**: Floodlight (Campaign Manager) tags are not part of
 *     the unified Google tag at all — a Floodlight destination always needs
 *     its own linker. Atlas does not generate Floodlight tags today (no
 *     `FloodlightDestination` exists anywhere in `GoogleTagDestinations` or
 *     the IR); this input is a forward-looking hook for when it does,
 *     always `false` from current callers.
 *
 * Net effect: the Conversion Linker tag is skipped in exactly one case —
 * single-domain, non-sGTM, non-Floodlight, with a sitewide Google tag
 * already firing — since that is the one case with genuinely unambiguous
 * public guidance behind it. Every other case keeps emitting the linker,
 * favouring "possibly redundant tag" over "possibly broken attribution".
 */

export interface LinkerDecisionInputs {
  /** True when a sitewide Google tag (`googtag`) is present and fires on every page. */
  hasGoogleTagFiring: boolean;
  /** True when a Floodlight (Campaign Manager) destination is configured. Always false today — see module header. */
  hasFloodlight: boolean;
  /** True when the client has secondary domains requiring cross-domain linking. */
  crossDomainNeeded: boolean;
  /** True when traffic routes through a verified server-side GTM endpoint. */
  serverContainerConfigured: boolean;
}

export interface LinkerDecision {
  emitConversionLinker: boolean;
  reason: string;
}

export function decideConversionLinker(inputs: LinkerDecisionInputs): LinkerDecision {
  if (inputs.hasFloodlight) {
    return {
      emitConversionLinker: true,
      reason: 'Floodlight destinations are not covered by the Google tag\'s built-in click-ID handling',
    };
  }
  if (inputs.serverContainerConfigured) {
    return {
      emitConversionLinker: true,
      reason: 'Server-side GTM routing needs its own client-side linker writing the click-ID cookie the server container expects',
    };
  }
  if (inputs.crossDomainNeeded) {
    return {
      emitConversionLinker: true,
      reason: 'Cross-domain linking is configured explicitly on the Conversion Linker tag — not confirmed redundant with the Google tag\'s own cross-domain config without a live export',
    };
  }
  if (!inputs.hasGoogleTagFiring) {
    return {
      emitConversionLinker: true,
      reason: 'No sitewide Google tag is present to auto-capture Google click IDs for this destination',
    };
  }
  return {
    emitConversionLinker: false,
    reason: 'A sitewide Google tag is already present and firing on every page, single-domain, no sGTM — it auto-captures Google click IDs for its own destinations, making a standalone Conversion Linker tag redundant',
  };
}
