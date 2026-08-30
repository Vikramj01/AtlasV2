/**
 * Meta has no built-in cross-domain mechanism (unlike GA4's linked_domains or
 * Google Ads' Conversion Linker) — _fbc/_fbp are host-scoped cookies that do
 * not survive a true domain change. This module produces the client-side
 * link-decoration snippet that carries fbclid across a domain handoff, shared
 * by the Planning Mode GTM container generator and the Journey Builder spec
 * generator so the logic (and its script-injection escaping) lives in one place.
 */

/**
 * JSON-serialize a value for embedding inside an inline `<script>` block.
 * Escapes `<` so a user-supplied string (e.g. a secondary domain) containing
 * `</script>` can't prematurely close the tag when the snippet is rendered
 * in a browser.
 */
export function jsonForInlineScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/**
 * Builds the "Atlas — Meta Cross-Domain Link Decorator" script: intercepts
 * clicks on links pointing at a secondary domain and appends fbclid (read
 * from the stored _fbc cookie, falling back to the current URL) before
 * navigation, so the destination domain's fbclid-capture logic can recapture
 * it on landing.
 */
export function buildMetaCrossDomainDecoratorScript(secondaryDomains: string[]): string {
  return `<script>
(function() {
  try {
    var secondaryDomains = ${jsonForInlineScript(secondaryDomains)};
    function getFbclid() {
      var match = document.cookie.match(/(^| )_fbc=([^;]+)/);
      if (match) {
        var parts = decodeURIComponent(match[2]).split('.');
        var last = parts[parts.length - 1];
        if (last) return last;
      }
      var params = new URLSearchParams(window.location.search);
      return params.get('fbclid');
    }
    document.addEventListener('click', function(evt) {
      var link = evt.target && evt.target.closest ? evt.target.closest('a[href]') : null;
      if (!link) return;
      var url;
      try { url = new URL(link.href, window.location.href); } catch (e) { return; }
      var host = url.hostname.replace(/^www\\./, '');
      if (secondaryDomains.indexOf(host) === -1) return;
      if (url.searchParams.has('fbclid')) return;
      var fbclid = getFbclid();
      if (!fbclid) return;
      url.searchParams.set('fbclid', fbclid);
      link.setAttribute('href', url.toString());
    }, true);
  } catch (e) {}
})();
</script>`;
}
