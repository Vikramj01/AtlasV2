/**
 * Browserbase client — managed Playwright sessions.
 * Docs: https://docs.browserbase.com
 * SDK: @browserbasehq/sdk
 */
import { env } from '@/config/env';
import logger from '@/utils/logger';

export interface BrowserbaseSessionInfo {
  id: string;
  debugUrl?: string;
}

/**
 * Create a new Browserbase session and return its ID.
 * Lazy-require the SDK so the server starts without it installed (unit tests bypass this path).
 *
 * @param userMetadata - Optional key/value pairs tagged on the session in Browserbase.
 *   Used for attribution if internal usage logging ever fails — the operator can then
 *   cross-reference Browserbase's session list against Atlas records.
 */
export async function createBrowserbaseSession(
  userMetadata?: Record<string, string>,
): Promise<BrowserbaseSessionInfo> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Browserbase = require('@browserbasehq/sdk').default as {
    new (opts: { apiKey: string }): {
      sessions: {
        create(opts: { projectId: string; proxies?: boolean; browserSettings?: object; userMetadata?: Record<string, string> }): Promise<{ id: string; debuggerUrl?: string }>;
      };
    };
  };

  const bb = new Browserbase({ apiKey: env.BROWSERBASE_API_KEY });
  const session = await bb.sessions.create({
    projectId: env.BROWSERBASE_PROJECT_ID,
    proxies: env.BROWSERBASE_USE_PROXIES,
    ...(userMetadata ? { userMetadata } : {}),
    browserSettings: {
      viewport: { width: 1280, height: 800 },
      fingerprint: {
        // Randomise device fingerprint so each session looks like a real user
        devices: ['desktop'],
        locales: ['en-US', 'en-GB'],
        operatingSystems: ['windows', 'macos'],
      },
    },
  });

  logger.info({ sessionId: session.id }, 'Browserbase session created');
  return { id: session.id, debugUrl: session.debuggerUrl };
}

/**
 * Return the CDP WebSocket URL for a Browserbase session.
 * Playwright connects with: chromium.connectOverCDP(cdpUrl)
 */
export function getCDPUrl(sessionId: string): string {
  return `wss://connect.browserbase.com?apiKey=${env.BROWSERBASE_API_KEY}&sessionId=${sessionId}`;
}
