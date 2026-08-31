// Shared HTTP reachability probe — HEAD request with a timeout and
// pass/degraded/fail/timeout/error classification. Extracted from
// gtgProbe.ts's inline logic since sgtmProbe.ts and the on-demand sGTM
// verify endpoint both need the identical check.

export interface HttpProbeResult {
  checkStatus: 'pass' | 'degraded' | 'fail' | 'timeout' | 'error';
  httpStatus: number | null;
  responseMs: number | null;
  errorMessage: string | null;
}

export async function probeUrl(
  url: string,
  degradedThresholdMs = 2000,
  timeoutMs = 5000,
): Promise<HttpProbeResult> {
  const start = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(url, { method: 'HEAD', signal: controller.signal });
    clearTimeout(timeout);

    const responseMs = Date.now() - start;
    let checkStatus: HttpProbeResult['checkStatus'];
    if (!res.ok) {
      checkStatus = 'fail';
    } else if (responseMs > degradedThresholdMs) {
      checkStatus = 'degraded';
    } else {
      checkStatus = 'pass';
    }

    return { checkStatus, httpStatus: res.status, responseMs, errorMessage: res.ok ? null : `HTTP ${res.status}` };
  } catch (err) {
    const responseMs = Date.now() - start;
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    return {
      checkStatus: isTimeout ? 'timeout' : 'error',
      httpStatus: null,
      responseMs,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}
