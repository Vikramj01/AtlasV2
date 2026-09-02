// Storefront click-ID capture script, auto-injected via Shopify's ScriptTag
// API (see registerScriptTag() in shopifyClient.ts). Runs on every
// storefront page: captures gclid/fbclid/wbraid/gbraid from the landing
// URL, persists them locally, and pushes them as Shopify cart attributes
// so they ride through checkout into the completed order's
// note_attributes (read back out in shopifyOrderMapper.ts).
//
// Cookie conventions match what Atlas's own GTM container generator
// already uses for the same click IDs (gtmContainerGenerator.ts's
// "Atlas — Store GCLID"/"Atlas — Store FBCLID" tags) — reused here rather
// than invented, so a merchant with both Atlas GTM tags and this Shopify
// app sees consistent cookie values:
//   _gcl_aw = "GCL.<unix_seconds>.<gclid>"
//   _fbc    = "fb.1.<Date.now()_ms>.<fbclid>"   (Meta's own _fbc format —
//             the CAPI pipeline expects this exact formatted value for
//             user_data.fbc, not the raw fbclid)
//   wbraid/gbraid have no established computed format anywhere in this
//   codebase — stored raw, matching gtmContainerGenerator.ts's
//   "_atlas_wbraid"/"_atlas_gbraid" cookies.
//
// The cart-attribute NAMES below (atlas_gclid/atlas_fbc/atlas_wbraid/
// atlas_gbraid) are Atlas's own — defined and read back only by Atlas's
// own code (this script + shopifyOrderMapper.ts), not a Shopify or
// third-party convention, so there's no external-field-name guessing risk.
//
// gclid/wbraid/gbraid are pushed RAW (matching DMA's AdIdentifiers shape,
// which wants the bare click ID) — only fbc is pushed pre-formatted
// (matching Meta CAPI's user_data.fbc expectation).

export const SHOPIFY_CAPTURE_SCRIPT = `
(function() {
  function getQueryParam(name) {
    var m = new RegExp('[?&]' + name + '=([^&]+)').exec(window.location.search);
    return m ? decodeURIComponent(m[1].replace(/\\+/g, ' ')) : null;
  }
  function setCookie(name, value, days) {
    var d = new Date();
    d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
    document.cookie = name + '=' + encodeURIComponent(value) + ';expires=' + d.toUTCString() + ';path=/;SameSite=Lax';
  }
  function getCookie(name) {
    var match = document.cookie.match('(^|;)\\\\s*' + name + '\\\\s*=\\\\s*([^;]+)');
    return match ? decodeURIComponent(match.pop()) : null;
  }

  var gclid = getQueryParam('gclid');
  if (gclid) {
    setCookie('_gcl_aw', 'GCL.' + Math.floor(Date.now() / 1000) + '.' + gclid, 90);
    setCookie('_atlas_gclid_raw', gclid, 90);
  }
  var fbclid = getQueryParam('fbclid');
  if (fbclid) {
    setCookie('_fbc', 'fb.1.' + Date.now() + '.' + fbclid, 90);
  }
  var wbraid = getQueryParam('wbraid');
  if (wbraid) setCookie('_atlas_wbraid', wbraid, 90);
  var gbraid = getQueryParam('gbraid');
  if (gbraid) setCookie('_atlas_gbraid', gbraid, 90);

  var attributes = {};
  var storedGclid = getCookie('_atlas_gclid_raw');
  if (storedGclid) attributes['atlas_gclid'] = storedGclid;
  var storedFbc = getCookie('_fbc');
  if (storedFbc) attributes['atlas_fbc'] = storedFbc;
  var storedWbraid = getCookie('_atlas_wbraid');
  if (storedWbraid) attributes['atlas_wbraid'] = storedWbraid;
  var storedGbraid = getCookie('_atlas_gbraid');
  if (storedGbraid) attributes['atlas_gbraid'] = storedGbraid;

  if (Object.keys(attributes).length === 0) return;

  // Safe to call on every page load — Shopify's Ajax Cart API merges
  // attributes, so this just keeps them current through to checkout.
  // Silently no-ops if there's no cart yet (e.g. no cart cookie) or the
  // request fails — this must never break the storefront.
  fetch('/cart/update.js', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ attributes: attributes }),
  }).catch(function () {});
})();
`.trim();
