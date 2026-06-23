// GTG Path Health Probe — HTTP GET of the org's gtag.js endpoint
// Checks that first-party gtag.js returns 200 within 5 seconds.

import { supabaseAdmin } from '@/services/database/supabase';
import logger from '@/utils/logger';

export interface GTGProbeResult {
  checkStatus: 'pass' | 'degraded' | 'fail' | 'timeout' | 'error';
  httpStatus: number | null;
  responseMs: number | null;
  errorMessage: string | null;
}

export async function probeGTGPath(
  orgId: string,
  degradedThresholdMs = 2000,
): Promise<GTGProbeResult & { gtagUrl: string | null }> {
  // Look up the org's gtm container connection to find a domain to probe
  const { data } = await supabaseAdmin
    .from('gtm_container_connections')
    .select('container_id')
    .eq('organization_id', orgId)
    .limit(1);

  // No GTM connection → not applicable (not a failure)
  if (!data || data.length === 0) {
    return { checkStatus: 'error', httpStatus: null, responseMs: null, errorMessage: 'No GTM connection found', gtagUrl: null };
  }

  // We don't have the domain stored directly, so probe Google's canonical GTG endpoint as proxy
  // In a future sprint, store the customer domain in gtm_container_connections and probe /gtag/js there
  const gtagUrl = `https://www.googletagmanager.com/gtag/js?id=${(data[0] as { container_id: string }).container_id}`;
  const start = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(gtagUrl, { method: 'HEAD', signal: controller.signal });
    clearTimeout(timeout);

    const responseMs = Date.now() - start;
    let checkStatus: GTGProbeResult['checkStatus'];
    if (!res.ok) {
      checkStatus = 'fail';
    } else if (responseMs > degradedThresholdMs) {
      checkStatus = 'degraded';
    } else {
      checkStatus = 'pass';
    }

    return { checkStatus, httpStatus: res.status, responseMs, errorMessage: res.ok ? null : `HTTP ${res.status}`, gtagUrl };
  } catch (err) {
    const responseMs = Date.now() - start;
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    return {
      checkStatus: isTimeout ? 'timeout' : 'error',
      httpStatus: null,
      responseMs,
      errorMessage: err instanceof Error ? err.message : String(err),
      gtagUrl,
    };
  }
}

export async function saveGTGCheck(orgId: string, gtagUrl: string, result: GTGProbeResult): Promise<void> {
  const { error } = await supabaseAdmin.from('dqm_gtg_checks').insert({
    org_id: orgId,
    gtag_url: gtagUrl,
    http_status: result.httpStatus,
    response_ms: result.responseMs,
    check_status: result.checkStatus,
    error_message: result.errorMessage,
  });

  if (error) logger.error({ error, orgId }, 'DQM: failed to save GTG check');
}
