/**
 * Developer Handoff Document Generator
 *
 * Produces a Markdown file that a developer can read directly — no browser
 * required. Covers every event, its dataLayer snippet, which platforms it
 * fires to, required params, and step-by-step GTM import instructions.
 *
 * Replaces the HTML implementation guide for developer-facing output.
 */
import type { PlanningRecommendation, PlanningPage, PlanningSession } from '@/types/planning';
import type { GTMContainerJSON } from './gtmContainerGenerator';
import { derivePlaceholderTable } from './renderer/guide.renderer';

// ── TrackingPlan type ─────────────────────────────────────────────────────────

export interface TrackingPlanEvent {
  event_name:      string;
  page_label:      string;
  page_url:        string;
  trigger:         string;
  platforms:       string[];
  required_params: string[];
  optional_params: string[];
  priority:        'must_have' | 'should_have' | 'nice_to_have';
}

export interface TrackingPlan {
  session_id:      string;
  site_url:        string;
  business_type:   string;
  generated_at:    string;
  events:          TrackingPlanEvent[];
  platform_count:  number;
  conversion_count: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildTrackingPlan(
  recommendations: PlanningRecommendation[],
  pages: PlanningPage[],
  session: PlanningSession,
): TrackingPlan {
  const pageMap = new Map(pages.map((p) => [p.id, p]));
  const conversionActions = new Set(['purchase', 'generate_lead', 'sign_up', 'begin_checkout']);

  const events: TrackingPlanEvent[] = recommendations.map((rec) => {
    const page = pageMap.get(rec.page_id);
    return {
      event_name:      rec.event_name,
      page_label:      page?.page_title ?? page?.page_type ?? 'Unknown page',
      page_url:        page?.url ?? '',
      trigger:         rec.action_type,
      platforms:       rec.affected_platforms as string[],
      required_params: rec.required_params.map((p) => p.param_key),
      optional_params: rec.optional_params.map((p) => p.param_key),
      priority:        'should_have',
    };
  });

  const allPlatforms = new Set(events.flatMap((e) => e.platforms));
  // Count by trigger (= action_type), not event_name — custom event names like
  // "contact_form_submit" have action_type "generate_lead" which IS a conversion.
  const conversionCount = events.filter((e) => conversionActions.has(e.trigger)).length;

  return {
    session_id:      session.id,
    site_url:        session.website_url,
    business_type:   session.business_type,
    generated_at:    new Date().toISOString(),
    events,
    platform_count:  allPlatforms.size,
    conversion_count: conversionCount,
  };
}

function dataLayerSnippet(eventName: string, params: string[]): string {
  const paramLines = params.map((k) => `  ${k}: '{{${k.toUpperCase()}}}'`).join(',\n');
  return `\`\`\`js\nwindow.dataLayer = window.dataLayer || [];\nwindow.dataLayer.push({\n  event: '${eventName}'${paramLines ? `,\n${paramLines}` : ''}\n});\n\`\`\``;
}

function platformBadges(platforms: string[]): string {
  return platforms.join(', ') || '—';
}

// ── Main generator ────────────────────────────────────────────────────────────

export function generateDeveloperHandoffDoc(
  recommendations: PlanningRecommendation[],
  pages: PlanningPage[],
  session: PlanningSession,
  gtmContainer?: GTMContainerJSON,
): string {
  const plan = buildTrackingPlan(recommendations, pages, session);
  const platforms = session.selected_platforms as string[];
  const now = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  const lines: string[] = [];

  // ── Header ────────────────────────────────────────────────────────────────
  lines.push(`# Tracking Implementation — Developer Handoff`);
  lines.push(``);
  lines.push(`**Site:** ${plan.site_url}`);
  lines.push(`**Business type:** ${plan.business_type}`);
  lines.push(`**Generated:** ${now}`);
  lines.push(`**Total events:** ${plan.events.length} · **Conversions:** ${plan.conversion_count} · **Platforms:** ${plan.platform_count}`);
  lines.push(``);
  lines.push(`---`);
  lines.push(``);

  // ── Overview ──────────────────────────────────────────────────────────────
  lines.push(`## Overview`);
  lines.push(``);
  lines.push(`This document tells you exactly what tracking code to add and where.`);
  lines.push(`Each section covers one page of the site. Add the dataLayer snippet`);
  lines.push(`to the page before GTM fires (typically in \`<head>\` or on page load).`);
  lines.push(``);
  lines.push(`**Prerequisites:**`);
  lines.push(`- Google Tag Manager container already on the site`);
  lines.push(`- GTM Container JSON imported (see Section 2)`);
  lines.push(`- Platform IDs filled in (see Section 3)`);
  lines.push(``);
  lines.push(`---`);
  lines.push(``);

  // ── Section 1: Events per page ────────────────────────────────────────────
  lines.push(`## 1. Events by page`);
  lines.push(``);

  const byPage = new Map<string, TrackingPlanEvent[]>();
  for (const evt of plan.events) {
    const key = `${evt.page_label}|||${evt.page_url}`;
    if (!byPage.has(key)) byPage.set(key, []);
    byPage.get(key)!.push(evt);
  }

  for (const [key, events] of byPage) {
    const [pageLabel, pageUrl] = key.split('|||');
    lines.push(`### ${pageLabel}`);
    if (pageUrl) lines.push(`*URL: \`${pageUrl}\`*`);
    lines.push(``);

    for (const evt of events) {
      lines.push(`#### \`${evt.event_name}\``);
      lines.push(``);
      lines.push(`| Field | Value |`);
      lines.push(`|---|---|`);
      lines.push(`| Trigger | ${evt.trigger} |`);
      lines.push(`| Platforms | ${platformBadges(evt.platforms)} |`);
      lines.push(`| Required params | ${evt.required_params.join(', ') || '—'} |`);
      lines.push(`| Optional params | ${evt.optional_params.join(', ') || '—'} |`);
      lines.push(``);
      lines.push(`**dataLayer snippet:**`);
      lines.push(``);
      lines.push(dataLayerSnippet(evt.event_name, evt.required_params));
      lines.push(``);
    }

    lines.push(`---`);
    lines.push(``);
  }

  // ── Section 2: GTM setup ──────────────────────────────────────────────────
  lines.push(`## 2. Import the GTM container`);
  lines.push(``);
  lines.push(`1. Download \`atlas-gtm-container.json\` from the Atlas dashboard`);
  lines.push(`2. Open Google Tag Manager → select your container`);
  lines.push(`3. Go to **Admin → Import Container**`);
  lines.push(`4. Upload the JSON file`);
  lines.push(`5. Choose **Merge → Rename conflicting tags** to avoid overwriting existing tags`);
  lines.push(`6. Click **Confirm** — the workspace now has all Atlas tags, triggers, and variables`);
  lines.push(`7. Open **Preview mode** to verify events fire correctly before publishing`);
  lines.push(``);
  lines.push(`---`);
  lines.push(``);

  // ── Section 3: Platform IDs ───────────────────────────────────────────────
  lines.push(`## 3. Platform IDs to fill in`);
  lines.push(``);
  lines.push(`After importing, update these GTM variables (Variables → User-Defined Variables):`);
  lines.push(``);

  // Derive placeholder table from the rendered container's CONST variables.
  // Falls back to a platform-filtered heuristic when the container is not available.
  if (gtmContainer) {
    const rows = derivePlaceholderTable(gtmContainer.containerVersion.variable, platforms);
    if (rows.length > 0) {
      lines.push(`| Variable name | Description | Where to find it | Example |`);
      lines.push(`|---|---|---|---|`);
      for (const row of rows) {
        lines.push(`| \`${row.variable_name}\` | ${row.description} | ${row.where_to_find} | \`${row.example}\` |`);
      }
    } else {
      lines.push(`_No placeholder variables found — all platform IDs may have been pre-filled._`);
    }
  } else {
    // Static fallback when container is not threaded through
    lines.push(`| Variable name | Where to find it | Example |`);
    lines.push(`|---|---|---|`);
    if (platforms.includes('ga4')) {
      lines.push(`| \`CONST - GA4 Measurement ID\` | GA4 → Admin → Data Streams → Measurement ID | \`G-XXXXXXXXXX\` |`);
    }
    if (platforms.includes('google_ads')) {
      lines.push(`| \`CONST - Google Ads Conversion ID\` | Google Ads → Tools → Conversions → Tag setup | \`AW-XXXXXXXXX\` |`);
      lines.push(`| \`CONST - GAds Conversion Label - *\` | Google Ads → Goals → Conversions → select conversion | \`AbCdEfGhIj\` |`);
    }
    if (platforms.includes('meta')) {
      lines.push(`| \`CONST - Meta Pixel ID\` | Meta Business Manager → Events Manager → Pixel ID | \`1234567890123456\` |`);
    }
    if (platforms.includes('tiktok')) {
      lines.push(`| \`CONST - TikTok Pixel ID\` | TikTok Ads Manager → Assets → Events → Pixel ID | \`C4XXXXXXXXXX\` |`);
    }
    if (platforms.includes('linkedin')) {
      lines.push(`| \`CONST - LinkedIn Partner ID\` | LinkedIn Campaign Manager → Account Assets → Insight Tag | \`1234567\` |`);
    }
  }
  lines.push(``);
  lines.push(`---`);
  lines.push(``);

  // ── Section 4: Consent Mode v2 ────────────────────────────────────────────
  lines.push(`## 4. Consent Mode v2`);
  lines.push(``);
  lines.push(`The container includes two consent tags:`);
  lines.push(``);
  lines.push(`- **Atlas - Consent Mode v2 Default** — fires on every page load, sets all consent to \`denied\` by default`);
  lines.push(`- **Atlas - Consent Mode v2 Update** — fires on the \`consent_update\` dataLayer event`);
  lines.push(``);
  lines.push(`To connect your CMP (Consent Management Platform):`);
  lines.push(``);
  lines.push(`\`\`\`js`);
  lines.push(`// Fire this when the user accepts consent in your CMP`);
  lines.push(`window.dataLayer.push({`);
  lines.push(`  event: 'consent_update',`);
  lines.push(`  analytics: true,  // set false if analytics was declined`);
  lines.push(`  ads: true         // set false if ads was declined`);
  lines.push(`});`);
  lines.push(`\`\`\``);
  lines.push(``);
  lines.push(`---`);
  lines.push(``);

  // ── Section 5: Enhanced Conversions (Google Ads) ──────────────────────────
  if (platforms.includes('google_ads')) {
    lines.push(`## 5. Enhanced Conversions (Google Ads)`);
    lines.push(``);
    lines.push(`The GTM container is configured with Enhanced Conversions enabled on every Google Ads conversion tag.`);
    lines.push(`This improves measurement accuracy by matching hashed first-party data to signed-in Google accounts.`);
    lines.push(``);
    lines.push(`**What you need to do:**`);
    lines.push(``);
    lines.push(`Before each conversion event fires, push the user's contact details to the dataLayer:`);
    lines.push(``);
    lines.push(`\`\`\`js`);
    lines.push(`// Push user data BEFORE the conversion event`);
    lines.push(`window.dataLayer = window.dataLayer || [];`);
    lines.push(`window.dataLayer.push({`);
    lines.push(`  user_data: {`);
    lines.push(`    email: user.email,           // Required — raw email; Google hashes it`);
    lines.push(`    phone_number: user.phone,    // Optional — E.164 format, e.g. '+447911123456'`);
    lines.push(`  }`);
    lines.push(`});`);
    lines.push(``);
    lines.push(`// Then push the conversion event`);
    lines.push(`window.dataLayer.push({`);
    lines.push(`  event: 'your_conversion_event',`);
    lines.push(`  value: 0,`);
    lines.push(`  currency: 'GBP'`);
    lines.push(`});`);
    lines.push(`\`\`\``);
    lines.push(``);
    lines.push(`**GTM variables used:**`);
    lines.push(``);
    lines.push(`| Variable | dataLayer path | Purpose |`);
    lines.push(`|---|---|---|`);
    lines.push(`| \`DLV - user_data.email\` | \`user_data.email\` | Raw email for EC matching |`);
    lines.push(`| \`DLV - user_data.phone_number\` | \`user_data.phone_number\` | Phone number for EC matching |`);
    lines.push(``);
    lines.push(`> **Privacy note:** Email and phone are sent over HTTPS and hashed by Google's servers. Never log or expose these values outside of the secure dataLayer push.`);
    lines.push(``);
    lines.push(`---`);
    lines.push(``);
  }

  // ── Section 6: Testing checklist ─────────────────────────────────────────
  lines.push(`## ${platforms.includes('google_ads') ? '6' : '5'}. Testing checklist`);
  lines.push(``);
  lines.push(`Use GTM Preview mode + GA4 DebugView to verify each item:`);
  lines.push(``);

  for (const evt of plan.events) {
    lines.push(`- [ ] \`${evt.event_name}\` fires on **${evt.page_label}**`);
    for (const param of evt.required_params) {
      lines.push(`  - [ ] \`${param}\` is populated`);
    }
  }

  lines.push(``);
  lines.push(`---`);
  lines.push(``);
  lines.push(`*Generated by Atlas · atlas.vimi.digital*`);

  return lines.join('\n');
}

export { buildTrackingPlan };
