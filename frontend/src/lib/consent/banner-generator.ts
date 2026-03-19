/**
 * Banner Generator
 *
 * Produces a self-contained JavaScript snippet that site owners embed in their
 * <head> tag. The snippet:
 *   1. Sets default GCM v2 signals (deny-all, privacy-first)
 *   2. Checks localStorage for a prior consent decision
 *   3. If found → fires gtag consent update immediately (no banner shown)
 *   4. If not found → renders the consent banner and records the decision via
 *      POST /api/consent/record
 *
 * The generated JS is Atlas-authored (safe). It does NOT execute any
 * user-supplied content — only configuration values are embedded.
 *
 * Security: All string config values are JSON.stringified before embedding
 * to prevent injection.
 */

import type { ConsentConfig } from '@/types/consent';

export interface BannerSnippet {
  /** The full JavaScript to embed in <head> */
  script: string;
  /** A minified version for production use */
  minified: string;
  /** Embed instructions */
  instructions: string;
}

/**
 * Generate the consent banner JavaScript snippet for a given project config.
 */
export function generateBannerSnippet(config: ConsentConfig, apiBaseUrl: string): BannerSnippet {
  const script = buildScript(config, apiBaseUrl);
  const minified = minifyScript(script);
  const instructions = buildInstructions(config, minified);

  return { script, minified, instructions };
}

// ── Script builder ────────────────────────────────────────────────────────────

function buildScript(config: ConsentConfig, apiBaseUrl: string): string {
  const banner = config.banner_config;
  const colors = banner?.colors ?? {
    background: '#1e1e2e',
    button_primary: '#6c63ff',
    button_secondary: '#4a4a5a',
    text: '#ffffff',
  };
  const copy = banner?.copy ?? {
    heading: 'We use cookies',
    body: 'We use cookies to improve your experience, measure performance, and serve personalised ads.',
    accept_button: 'Accept all',
    reject_button: 'Reject non-essential',
    manage_link: 'Manage preferences',
  };
  const position = banner?.position ?? 'bottom_bar';
  const ttlDays = banner?.ttl_days ?? 180;

  // All user-configurable strings are JSON.stringified to prevent injection
  const cfg = {
    projectId: JSON.stringify(config.project_id),
    apiBase: JSON.stringify(apiBaseUrl),
    position: JSON.stringify(position),
    ttlDays: ttlDays,
    bg: JSON.stringify(colors.background),
    btnPrimary: JSON.stringify(colors.button_primary),
    btnSecondary: JSON.stringify(colors.button_secondary),
    textColor: JSON.stringify(colors.text),
    heading: JSON.stringify(copy.heading),
    body: JSON.stringify(copy.body),
    acceptBtn: JSON.stringify(copy.accept_button),
    rejectBtn: JSON.stringify(copy.reject_button),
    manageLink: JSON.stringify(copy.manage_link),
    gcmEnabled: config.gcm_enabled,
  };

  return `
/* Atlas Consent Banner v1 — generated ${new Date().toISOString().slice(0, 10)} */
(function () {
  'use strict';

  var PROJECT_ID = ${cfg.projectId};
  var API_BASE   = ${cfg.apiBase};
  var POSITION   = ${cfg.position};
  var TTL_DAYS   = ${cfg.ttlDays};
  var GCM_ENABLED = ${cfg.gcmEnabled};
  var STORAGE_KEY = 'atlas_consent';
  var VID_KEY     = 'atlas_vid';

  // ── GCM defaults (deny-all, privacy-first) ──────────────────────────────────
  if (GCM_ENABLED && typeof gtag === 'function') {
    gtag('consent', 'default', {
      analytics_storage: 'denied',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      personalization_storage: 'denied',
      functionality_storage: 'granted',
      security_storage: 'granted',
      wait_for_update: 2000
    });
  }

  // ── Visitor ID ──────────────────────────────────────────────────────────────
  function getVisitorId() {
    try {
      var id = localStorage.getItem(VID_KEY);
      if (id) return id;
      id = crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
      localStorage.setItem(VID_KEY, id);
      return id;
    } catch (e) { return 'anon'; }
  }

  // ── Check for prior consent ─────────────────────────────────────────────────
  function loadSaved() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var snap = JSON.parse(raw);
      if (snap.project_id !== PROJECT_ID) return null;
      if (new Date(snap.expires_at) < new Date()) { localStorage.removeItem(STORAGE_KEY); return null; }
      return snap;
    } catch (e) { return null; }
  }

  function applyGCM(gcmState) {
    if (!GCM_ENABLED || typeof gtag !== 'function') return;
    gtag('consent', 'update', gcmState);
  }

  var saved = loadSaved();
  if (saved) { applyGCM(saved.gcm_state); return; } // Prior consent — no banner

  // ── Render banner ───────────────────────────────────────────────────────────
  function renderBanner() {
    if (document.getElementById('atlas-consent-banner')) return;

    var posStyles = POSITION === 'modal'
      ? 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);border-radius:12px;max-width:480px;width:90%;'
      : POSITION === 'corner'
      ? 'position:fixed;bottom:24px;right:24px;border-radius:12px;max-width:380px;'
      : 'position:fixed;bottom:0;left:0;right:0;border-radius:0;';

    var banner = document.createElement('div');
    banner.id = 'atlas-consent-banner';
    banner.style.cssText = posStyles +
      'background:' + ${cfg.bg} + ';' +
      'color:' + ${cfg.textColor} + ';' +
      'padding:20px 24px;z-index:999999;font-family:system-ui,sans-serif;' +
      'box-shadow:0 -4px 24px rgba(0,0,0,0.3);';

    // Build banner DOM without innerHTML to prevent XSS from user-configured text
    var h3 = document.createElement('h3');
    h3.style.cssText = 'margin:0 0 8px;font-size:16px;font-weight:600;';
    h3.textContent = ${cfg.heading};

    var p = document.createElement('p');
    p.style.cssText = 'margin:0 0 16px;font-size:14px;opacity:0.85;line-height:1.5;';
    p.textContent = ${cfg.body};

    var btnAccept = document.createElement('button');
    btnAccept.id = 'atlas-accept-all';
    btnAccept.style.cssText = 'background:' + ${cfg.btnPrimary} + ';color:#fff;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;font-size:14px;font-weight:500;';
    btnAccept.textContent = ${cfg.acceptBtn};

    var btnReject = document.createElement('button');
    btnReject.id = 'atlas-reject-all';
    btnReject.style.cssText = 'background:' + ${cfg.btnSecondary} + ';color:#fff;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;font-size:14px;';
    btnReject.textContent = ${cfg.rejectBtn};

    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;';
    btnRow.appendChild(btnAccept);
    btnRow.appendChild(btnReject);

    banner.appendChild(h3);
    banner.appendChild(p);
    banner.appendChild(btnRow);

    document.body.appendChild(banner);

    document.getElementById('atlas-accept-all').addEventListener('click', function () {
      handleDecision({ analytics: 'granted', marketing: 'granted', personalisation: 'granted', functional: 'granted' });
    });
    document.getElementById('atlas-reject-all').addEventListener('click', function () {
      handleDecision({ analytics: 'denied', marketing: 'denied', personalisation: 'denied', functional: 'granted' });
    });
  }

  // ── Handle decision ─────────────────────────────────────────────────────────
  function handleDecision(decisions) {
    var visitorId = getVisitorId();
    var consentId = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString();

    // Derive GCM state (simplified mapping — full mapping applied server-side)
    var gcmState = {
      analytics_storage:     decisions.analytics === 'granted'     ? 'granted' : 'denied',
      ad_storage:            decisions.marketing === 'granted'     ? 'granted' : 'denied',
      ad_user_data:          decisions.marketing === 'granted'     ? 'granted' : 'denied',
      ad_personalization:    decisions.marketing === 'granted'     ? 'granted' : 'denied',
      personalization_storage: decisions.personalisation === 'granted' ? 'granted' : 'denied',
      functionality_storage: 'granted',
      security_storage:      'granted'
    };

    applyGCM(gcmState);

    // Persist locally immediately (don't wait for server)
    var expires = new Date();
    expires.setDate(expires.getDate() + TTL_DAYS);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        decisions: decisions,
        gcm_state: gcmState,
        expires_at: expires.toISOString(),
        project_id: PROJECT_ID
      }));
    } catch (e) {}

    // Remove banner
    var el = document.getElementById('atlas-consent-banner');
    if (el) el.remove();

    // Record server-side (best-effort, no retry needed for MVP)
    fetch(API_BASE + '/api/consent/record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: PROJECT_ID,
        visitor_id: visitorId,
        consent_id: consentId,
        decisions: decisions,
        source: 'builtin',
        user_agent: navigator.userAgent
      })
    }).catch(function () {}); // silent fail — local state already persisted
  }

  // ── Wait for DOM ────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderBanner);
  } else {
    renderBanner();
  }
})();
`.trim();
}

// ── Minifier (lightweight — removes comments and excess whitespace) ───────────

function minifyScript(script: string): string {
  return script
    .replace(/\/\*[\s\S]*?\*\//g, '')        // block comments
    .replace(/\/\/.*$/gm, '')                  // line comments
    .replace(/\n\s*\n/g, '\n')                 // blank lines
    .replace(/^\s+/gm, '')                     // leading whitespace
    .replace(/\s{2,}/g, ' ')                   // multiple spaces
    .trim();
}

// ── Instructions ──────────────────────────────────────────────────────────────

function buildInstructions(config: ConsentConfig, minified: string): string {
  return `
## Atlas Consent Banner Installation

Paste the following snippet inside the <head> tag of every page, BEFORE your
Google Tag Manager or GA4 snippet:

\`\`\`html
<!-- Atlas Consent Banner — Project: ${config.project_id} -->
<script>
${minified}
</script>
\`\`\`

### What this does
1. Sets Google Consent Mode v2 default signals (deny-all, privacy-first)
2. Checks for a prior consent decision (stored in localStorage)
3. If found → immediately updates GCM signals — no banner shown
4. If not found → renders the consent banner

### Requirements
- Replace any placeholder API URL with your Atlas backend URL
- The snippet must load before GTM / GA4 snippets

### Testing
Open your browser console and run:
  localStorage.removeItem('atlas_consent')
Then reload the page — the banner should appear.

Project ID: ${config.project_id}
Mode: ${config.mode}
Regulation: ${config.regulation}
GCM enabled: ${config.gcm_enabled}
`.trim();
}
