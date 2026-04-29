import { supabaseAdmin } from '@/services/database/supabase';
import { getPageCap, getDomainCap } from '@/config/pricing';
import type { AtlasTier } from '@/config/pricing';
import type { PageToScan, UrlType } from '@/types/crawl';

/**
 * Assembles the page scope for an org crawl.
 * Respects the tier page cap per domain and total domain limit.
 * Priority order: higher priority value = scanned first.
 *
 * Returns pages with crawl_page_id = '' — the caller (route or scheduled
 * trigger) must insert crawl_pages rows and backfill crawl_page_id before
 * passing the list to the Bull job.
 */
export async function discoverPages(
  org_id: string,
  tier: string,
): Promise<PageToScan[]> {
  const pageCap    = getPageCap(tier as AtlasTier);
  const domainLimit = getDomainCap(tier as AtlasTier);

  const { data: scopePages, error } = await supabaseAdmin
    .from('org_page_scope')
    .select('id, url, url_type, domain, priority')
    .eq('org_id', org_id)
    .eq('is_active', true)
    .order('priority', { ascending: false });

  if (error) throw new Error(`Failed to load page scope: ${error.message}`);
  if (!scopePages?.length) return [];

  // Group by domain, apply per-domain page cap
  const byDomain = new Map<string, PageToScan[]>();

  for (const page of scopePages) {
    const existing = byDomain.get(page.domain) ?? [];
    if (existing.length < pageCap) {
      existing.push({
        scope_id:      page.id,
        crawl_page_id: '',          // filled in by caller after crawl_pages INSERT
        url:           page.url,
        url_type:      page.url_type as UrlType,
        domain:        page.domain,
        priority:      page.priority,
      });
      byDomain.set(page.domain, existing);
    }
  }

  // Apply domain limit and flatten
  const domains = Array.from(byDomain.keys()).slice(0, domainLimit);
  return domains.flatMap(d => byDomain.get(d) ?? []);
}

/**
 * Auto-detects conversion funnel pages from a domain by checking common URL
 * patterns on pages already in org_page_scope.
 * Called during onboarding before the first crawl.
 */
export async function detectFunnelPages(
  domain: string,
  org_id: string,
): Promise<string[]> {
  const funnelPatterns = [
    /\/signup/i, /\/register/i, /\/join/i,
    /\/login/i, /\/signin/i,
    /\/cart/i, /\/basket/i,
    /\/checkout/i,
    /\/thank[-_]?you/i, /\/order[-_]?confirmation/i, /\/success/i,
    /\/pricing/i, /\/plans/i,
    /\/demo/i, /\/trial/i,
  ];

  const { data: existingPages, error } = await supabaseAdmin
    .from('org_page_scope')
    .select('url')
    .eq('org_id', org_id)
    .eq('domain', domain);

  if (error) throw new Error(`Failed to load existing pages: ${error.message}`);

  return (existingPages ?? [])
    .map(p => p.url)
    .filter(url => funnelPatterns.some(p => p.test(url)));
}

/**
 * Seeds org_page_scope from a list of ad destination URLs.
 * Called during onboarding after ad account connection, or via the manual
 * seed endpoint.
 * Phase 1: accepts a URL list directly.
 * Phase 2: will pull live from Google Ads and Meta APIs.
 */
export async function seedPageScopeFromAdUrls(
  org_id: string,
  urls: string[],
  source: 'google_ads' | 'meta_ads' | 'manual',
): Promise<void> {
  const rows = urls.map((url, index) => {
    let domain: string;
    try {
      domain = new URL(url).hostname;
    } catch {
      throw new Error(`Invalid URL: ${url}`);
    }
    return {
      org_id,
      url,
      domain,
      url_type: 'ad_destination' as UrlType,
      source,
      priority: urls.length - index, // earlier in list = higher priority
    };
  });

  const { error } = await supabaseAdmin
    .from('org_page_scope')
    .upsert(rows, { onConflict: 'org_id,url', ignoreDuplicates: true });

  if (error) throw new Error(`Failed to seed page scope: ${error.message}`);
}
