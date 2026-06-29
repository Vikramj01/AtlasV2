/**
 * Public Audit Runner
 *
 * Orchestrates the no-login instant audit pipeline:
 *   1. Lightweight HTML parse (siteDetectionService) — zero cost
 *   2. Browserbase scan + signal detection (signalDetector logic)
 *   3. Debug-mode leak check
 *   4. Consent mode check
 *   5. Weighted scoring (0–100) → grade (A/B/C/D)
 *   6. Claude Haiku 3-sentence plain-English summary
 *   7. Persist results to public_audit_runs
 *
 * No org_id, no user context. Token is the sole access mechanism.
 */
import { supabaseAdmin } from '@/services/database/supabase';
import { detectSite } from '@/services/planning/siteDetectionService';
import { createBrowserbaseSession, getCDPUrl } from '@/services/browserbase/client';
import Anthropic from '@anthropic-ai/sdk';
import { env } from '@/config/env';
import logger from '@/utils/logger';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AuditFinding {
  check_id: string;
  label: string;
  passed: boolean;
  detail: string;
  weight: number;
}

interface SiteMeta {
  platform: string | null;
  business_type: string;
  tags_detected: string[];
}

// ── Check definitions (weight must sum to 100) ────────────────────────────────

const CHECKS = {
  GTM_PRESENT:        { label: 'Google Tag Manager detected',           weight: 20 },
  GTM_NO_DEBUG_LEAK:  { label: 'GTM not leaking debug mode to visitors', weight: 0  }, // bonus deduct only
  GA4_PRESENT:        { label: 'GA4 detected, no duplicate fires',       weight: 15 },
  META_PIXEL:         { label: 'Meta Pixel detected with event_id',      weight: 15 },
  GOOGLE_ADS:         { label: 'Google Ads conversion tag detected',      weight: 10 },
  CONSENT_MODE:       { label: 'Consent Mode signals present',           weight: 15 },
  NO_DUPLICATE_PIXEL: { label: 'No duplicate pixel implementations',     weight: 10 },
  SGTM_PRESENT:       { label: 'Server-side GTM (sGTM) detected',        weight: 10 },
  PLATFORM_KNOWN:     { label: 'Platform / CMS identified',              weight: 5  },
} as const;

type CheckId = keyof typeof CHECKS;

function gradeFromScore(score: number): 'A' | 'B' | 'C' | 'D' {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 50) return 'C';
  return 'D';
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function runPublicAudit(runId: string, url: string): Promise<void> {
  await setStatus(runId, 'scanning');

  try {
    // Step 1 — lightweight HTML parse (free, no Browserbase)
    const siteDetection = await detectSite(url).catch((err) => {
      logger.warn({ runId, url, err: String(err) }, 'Site detection failed, continuing');
      return null;
    });

    const siteMeta: SiteMeta = {
      platform:      siteDetection?.detected_platform?.name ?? null,
      business_type: siteDetection?.inferred_business_type ?? 'unknown',
      tags_detected: [],
    };

    if (siteDetection?.existing_tracking.gtm_detected)        siteMeta.tags_detected.push('GTM');
    if (siteDetection?.existing_tracking.ga4_detected)        siteMeta.tags_detected.push('GA4');
    if (siteDetection?.existing_tracking.meta_pixel_detected) siteMeta.tags_detected.push('Meta Pixel');
    if (siteDetection?.existing_tracking.google_ads_detected) siteMeta.tags_detected.push('Google Ads');
    if (siteDetection?.existing_tracking.tiktok_detected)     siteMeta.tags_detected.push('TikTok');
    if (siteDetection?.existing_tracking.linkedin_detected)   siteMeta.tags_detected.push('LinkedIn');

    // Step 2 — Browserbase scan
    const browserResults = await runBrowserbaseScan(url, runId);

    // Step 3 — Score all checks
    const findings = scoreFindings(siteDetection, browserResults);

    // Step 4 — Compute total score (sum of weights for passed checks)
    const score = findings.reduce((sum, f) => sum + (f.passed ? f.weight : 0), 0);
    const grade = gradeFromScore(score);

    // Step 5 — Claude Haiku summary
    const ai_summary = await generateSummary(url, score, grade, findings, siteMeta);

    // Step 6 — Persist
    await supabaseAdmin
      .from('public_audit_runs')
      .update({ status: 'done', score, grade, findings, ai_summary, site_meta: siteMeta })
      .eq('id', runId);

    logger.info({ runId, url, score, grade }, 'Public audit completed');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ runId, url, err: message }, 'Public audit failed');
    await supabaseAdmin
      .from('public_audit_runs')
      .update({ status: 'failed', error: message })
      .eq('id', runId);
  }
}

// ── Browserbase scan ──────────────────────────────────────────────────────────

interface BrowserScanResult {
  gtm_detected:           boolean;
  gtm_debug_leak:         boolean;
  ga4_detected:           boolean;
  ga4_duplicate_fire:     boolean;
  meta_pixel_detected:    boolean;
  meta_missing_event_id:  boolean;
  meta_pixel_ids:         string[];
  google_ads_detected:    boolean;
  sgtm_detected:          boolean;
  consent_mode_detected:  boolean;
  duplicate_pixel:        boolean;
}

async function runBrowserbaseScan(url: string, runId: string): Promise<BrowserScanResult> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { chromium } = require('playwright-core') as {
    chromium: { connectOverCDP(url: string): Promise<{
      newContext(opts?: object): Promise<{
        newPage(): Promise<{
          goto(url: string, opts?: object): Promise<{ status(): number } | null>;
          evaluate<T>(fn: () => T): Promise<T>;
          waitForTimeout(ms: number): Promise<void>;
          on(event: 'request', handler: (req: { url(): string }) => void): void;
          close(): Promise<void>;
        }>;
        close(): Promise<void>;
      }>;
      close(): Promise<void>;
    }> };
  };

  const bbSession = await createBrowserbaseSession({
    purpose:  'public_audit',
    run_id:   runId,
    url:      new URL(url).hostname,
  });

  const cdpUrl = getCDPUrl(bbSession.id);
  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 800 } });
  const page    = await context.newPage();

  const networkRequests: string[] = [];
  page.on('request', req => networkRequests.push(req.url()));

  try {
    await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForTimeout(2000);

    // ── GTM ──────────────────────────────────────────────────────────────────
    const gtmIds: string[] = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script[src]'));
      return scripts
        .map((s: Element) => (s as HTMLScriptElement).src ?? '')
        .filter((src: string) => src.includes('googletagmanager.com/gtm.js'))
        .map((src: string) => {
          try { return new URL(src).searchParams.get('id') ?? ''; } catch { return ''; }
        })
        .filter(Boolean);
    });

    const gtm_detected = gtmIds.length > 0;

    // Debug mode leak: GTM preview params present in any network request
    const gtm_debug_leak = networkRequests.some(u =>
      u.includes('gtm_debug') || u.includes('gtm_auth') || u.includes('gtm_preview'),
    );

    // ── GA4 ──────────────────────────────────────────────────────────────────
    const ga4Hits = networkRequests.filter(u =>
      u.includes('google-analytics.com/g/collect') ||
      u.includes('analytics.google.com/g/collect'),
    );
    const ga4_detected = ga4Hits.length > 0;
    const ga4MeasurementIds = [...new Set(
      ga4Hits.map(u => { try { return new URL(u).searchParams.get('tid') ?? ''; } catch { return ''; } }).filter(Boolean),
    )];
    const ga4_duplicate_fire = ga4Hits.length > ga4MeasurementIds.length * 2;

    // ── Meta Pixel ────────────────────────────────────────────────────────────
    const metaHits = networkRequests.filter(u =>
      u.includes('facebook.com/tr') || u.includes('connect.facebook.net'),
    );
    const meta_pixel_detected = metaHits.length > 0;
    const meta_pixel_ids = [...new Set(
      metaHits.map(u => { try { return new URL(u).searchParams.get('id') ?? ''; } catch { return ''; } }).filter(Boolean),
    )];
    const meta_missing_event_id = metaHits.some(u => {
      try { return !new URL(u).searchParams.has('eid'); } catch { return false; }
    });
    const duplicate_pixel = meta_pixel_ids.length > 1;

    // ── Google Ads ────────────────────────────────────────────────────────────
    const google_ads_detected = networkRequests.some(u =>
      u.includes('googleadservices.com/pagead/conversion') ||
      u.includes('google.com/pagead/conversion'),
    );

    // ── sGTM ─────────────────────────────────────────────────────────────────
    // sGTM requests go to a custom domain, not googletagmanager.com.
    // Detect via network requests to /g/collect (GA4 server-side) that are NOT
    // going to standard Google Analytics domains.
    const sgtm_detected = networkRequests.some(u => {
      try {
        const parsed = new URL(u);
        return (
          u.includes('/g/collect') &&
          !parsed.hostname.endsWith('google-analytics.com') &&
          !parsed.hostname.endsWith('analytics.google.com')
        );
      } catch { return false; }
    });

    // ── Consent Mode ──────────────────────────────────────────────────────────
    const consent_mode_detected: boolean = await page.evaluate(() => {
      // Look for gtag consent default call or dataLayer consent command
      const dl = (window as unknown as { dataLayer?: unknown[] }).dataLayer;
      if (Array.isArray(dl)) {
        return dl.some((entry: unknown) => {
          if (Array.isArray(entry)) return entry[0] === 'consent';
          if (entry && typeof entry === 'object') {
            const e = entry as Record<string, unknown>;
            return e['event'] === 'consent' || e[0] === 'consent';
          }
          return false;
        });
      }
      return false;
    });

    return {
      gtm_detected,
      gtm_debug_leak,
      ga4_detected,
      ga4_duplicate_fire,
      meta_pixel_detected,
      meta_missing_event_id,
      meta_pixel_ids,
      google_ads_detected,
      sgtm_detected,
      consent_mode_detected,
      duplicate_pixel,
    };
  } finally {
    await page.close().catch(() => undefined);
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

// ── Scoring ───────────────────────────────────────────────────────────────────

function scoreFindings(
  site: Awaited<ReturnType<typeof detectSite>> | null,
  browser: BrowserScanResult,
): AuditFinding[] {
  const findings: AuditFinding[] = [];

  const add = (id: CheckId, passed: boolean, detail: string) => {
    findings.push({ check_id: id, label: CHECKS[id].label, passed, detail, weight: CHECKS[id].weight });
  };

  // GTM present
  add('GTM_PRESENT', browser.gtm_detected,
    browser.gtm_detected
      ? 'Google Tag Manager container found on the page.'
      : 'No GTM container detected. Tracking tags may be hardcoded or missing entirely.');

  // GTM debug leak (deduct from GTM score — weight 0, purely informational)
  add('GTM_NO_DEBUG_LEAK', !browser.gtm_debug_leak,
    browser.gtm_debug_leak
      ? 'GTM debug/preview parameters found in live page requests. Every visitor is loading the debug container.'
      : 'No GTM debug mode parameters detected in production traffic.');

  // GA4
  add('GA4_PRESENT', browser.ga4_detected && !browser.ga4_duplicate_fire,
    browser.ga4_detected
      ? (browser.ga4_duplicate_fire ? 'GA4 detected but firing multiple times — possible duplicate tag.' : 'GA4 base tag firing correctly.')
      : 'GA4 not detected. Analytics data may be absent or misconfigured.');

  // Meta Pixel
  add('META_PIXEL', browser.meta_pixel_detected && !browser.meta_missing_event_id,
    browser.meta_pixel_detected
      ? (browser.meta_missing_event_id ? 'Meta Pixel detected but missing event_id — CAPI deduplication will fail.' : 'Meta Pixel detected with event_id present.')
      : 'Meta Pixel not detected.');

  // Google Ads
  add('GOOGLE_ADS', browser.google_ads_detected,
    browser.google_ads_detected
      ? 'Google Ads conversion tag detected.'
      : 'No Google Ads conversion tag detected. Conversion tracking may be absent.');

  // Consent mode
  add('CONSENT_MODE', browser.consent_mode_detected,
    browser.consent_mode_detected
      ? 'Consent Mode signals detected in dataLayer.'
      : 'No Consent Mode signals found. GDPR/CCPA compliance may be at risk and match rates will be lower.');

  // No duplicate pixel
  add('NO_DUPLICATE_PIXEL', !browser.duplicate_pixel,
    browser.duplicate_pixel
      ? `Multiple Meta Pixel IDs detected (${browser.meta_pixel_ids.join(', ')}). This inflates event counts.`
      : 'No duplicate pixel implementations detected.');

  // sGTM
  add('SGTM_PRESENT', browser.sgtm_detected,
    browser.sgtm_detected
      ? 'Server-side GTM detected — improved data reliability and match rates.'
      : 'No server-side GTM detected. Consider sGTM for better signal quality and ad platform match rates.');

  // Platform known
  const platformKnown = !!site?.detected_platform?.name;
  add('PLATFORM_KNOWN', platformKnown,
    platformKnown
      ? `Platform identified: ${site!.detected_platform!.name}.`
      : 'Platform/CMS could not be identified.');

  return findings;
}

// ── Claude Haiku summary ──────────────────────────────────────────────────────

async function generateSummary(
  url: string,
  score: number,
  grade: string,
  findings: AuditFinding[],
  siteMeta: SiteMeta,
): Promise<string> {
  try {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

    const passed   = findings.filter(f => f.passed).map(f => f.label);
    const failed   = findings.filter(f => !f.passed).map(f => f.label);
    const topIssue = findings.find(f => !f.passed && f.weight >= 10);

    const prompt = [
      `You are a marketing tracking expert. Write exactly 3 sentences summarising the audit results for ${url}.`,
      `Score: ${score}/100 (grade ${grade}). Platform: ${siteMeta.platform ?? 'unknown'}. Business type: ${siteMeta.business_type}.`,
      `Passed checks: ${passed.join(', ') || 'none'}.`,
      `Failed checks: ${failed.join(', ') || 'none'}.`,
      topIssue ? `Most impactful issue: ${topIssue.detail}` : '',
      `Write in plain English for a non-technical marketer. Do not use bullet points, markdown, or headers. 3 sentences only.`,
    ].filter(Boolean).join('\n');

    const response = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system:     'You write concise, plain-English audit summaries for marketers. 3 sentences maximum.',
      messages:   [{ role: 'user', content: prompt }],
    });

    const block = response.content[0];
    return block.type === 'text' ? block.text.trim() : '';
  } catch (err) {
    logger.warn({ err: String(err) }, 'Claude Haiku summary generation failed, skipping');
    return '';
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function setStatus(runId: string, status: string): Promise<void> {
  await supabaseAdmin.from('public_audit_runs').update({ status }).eq('id', runId);
}
