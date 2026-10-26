/**
 * Generator inputs for the Atlas Signal Tag beacon (GA4 Admin / L11 / Junk Gate follow-up to C3).
 *
 * Two values the generated container needs and `outputGenerator.ts` never supplied before:
 *  - `provider_token` — authenticates `/api/capi/browser-event`. Without it every container shipped
 *    the literal placeholder and the beacon (dedup + both junk-gate capture rules) returned 401.
 *  - `junk_honeypot_selector` — the CSS selector of a honeypot field the client's form already has.
 *
 * Each lookup is independent and NON-FATAL: a failure leaves that value unset, so generation behaves
 * exactly as it did before. The token is never logged (it authenticates the beacon).
 */
import { getBeaconProviderTokenForClient } from '@/services/database/capiQueries';
import { getClientIdentityConfig } from '@/services/database/enrichmentQueries';
import { sanitiseHoneypotSelector } from '@/services/capi/junkGate/honeypotSelector';
import logger from '@/utils/logger';

export interface BeaconGeneratorInputs {
  provider_token?: string;
  junk_honeypot_selector?: string;
}

export async function resolveBeaconInputs(clientId: string): Promise<BeaconGeneratorInputs> {
  const out: BeaconGeneratorInputs = {};

  try {
    const token = await getBeaconProviderTokenForClient(clientId);
    if (token) out.provider_token = token;
  } catch (err) {
    logger.warn({ clientId, err: (err as Error).message }, 'Could not resolve beacon provider token — leaving placeholder');
  }

  try {
    const identity = await getClientIdentityConfig(clientId);
    // Re-validated here, not just at save time: a row written before the allow-list (or by hand)
    // must not reach generated JavaScript.
    const selector = sanitiseHoneypotSelector(identity?.honeypot_selector);
    if (selector) out.junk_honeypot_selector = selector;
  } catch (err) {
    logger.warn({ clientId, err: (err as Error).message }, 'Could not resolve honeypot selector — beacon will not report honeypot state');
  }

  return out;
}
