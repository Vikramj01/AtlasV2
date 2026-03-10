/**
 * URL validation utilities.
 *
 * Enforces that all user-supplied URLs:
 *  - Are parseable as valid URLs
 *  - Use the https: scheme (http: allowed only in development)
 *  - Are not targeting localhost / private IP ranges (SSRF protection)
 *
 * These checks are applied before any URL is stored or passed to Browserbase.
 */

const ALLOWED_SCHEMES = new Set(['https:']);
if (process.env.NODE_ENV !== 'production') {
  ALLOWED_SCHEMES.add('http:');
}

// RFC-1918 private ranges + loopback + link-local + metadata endpoints
const BLOCKED_HOSTNAME_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,            // 127.0.0.0/8 loopback
  /^10\.\d+\.\d+\.\d+$/,             // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/, // 172.16.0.0/12
  /^192\.168\.\d+\.\d+$/,            // 192.168.0.0/16
  /^169\.254\.\d+\.\d+$/,            // 169.254.0.0/16 link-local / AWS metadata
  /^::1$/,                            // IPv6 loopback
  /^fc00:/i,                          // IPv6 ULA
  /^fe80:/i,                          // IPv6 link-local
];

export interface UrlValidationResult {
  valid: boolean;
  error?: string;
  normalized?: string;
}

export function validateUrl(raw: unknown): UrlValidationResult {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { valid: false, error: 'URL must be a non-empty string' };
  }

  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { valid: false, error: `Invalid URL: "${raw}"` };
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    const allowed = [...ALLOWED_SCHEMES].join(', ');
    return { valid: false, error: `URL scheme "${parsed.protocol}" is not allowed. Must be one of: ${allowed}` };
  }

  const hostname = parsed.hostname.toLowerCase();
  for (const pattern of BLOCKED_HOSTNAME_PATTERNS) {
    if (pattern.test(hostname)) {
      return { valid: false, error: `URL hostname "${hostname}" is not allowed` };
    }
  }

  return { valid: true, normalized: parsed.href };
}

/** Validate an array of URL strings. Returns the first error found, or null. */
export function validateUrls(raws: unknown[]): string | null {
  for (const raw of raws) {
    const result = validateUrl(raw);
    if (!result.valid) return result.error!;
  }
  return null;
}
