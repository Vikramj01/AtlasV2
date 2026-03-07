/**
 * DOM Simplifier — reduces a live Playwright page's DOM to a
 * compact, token-efficient tree suitable for Claude API analysis.
 *
 * Target: under 15,000 tokens when JSON-serialised.
 *
 * All heavy lifting runs inside the browser via page.evaluate() so
 * it has access to layout/style APIs (getBoundingClientRect, getComputedStyle).
 */
import type { SimplifiedDOMNode, InteractiveElement, FormCapture, FormField } from '@/types/planning';

// Playwright page shape we actually use
interface CapturablePage {
  evaluate<T>(fn: () => T): Promise<T>;
  evaluate<T, A>(fn: (arg: A) => T, arg: A): Promise<T>;
}

/** Tags whose subtrees we completely discard */
const DISCARD_TAGS = new Set([
  'script', 'style', 'noscript', 'head', 'link', 'meta', 'template',
  'iframe', 'object', 'embed', 'applet', 'base',
]);

/** Tags we keep as structural landmarks even when they have no interactive children */
const LANDMARK_TAGS = new Set([
  'header', 'nav', 'main', 'footer', 'section', 'article', 'aside',
  'h1', 'h2', 'h3', 'form',
]);

/** Tags that are intrinsically interactive */
const INTERACTIVE_TAGS = new Set([
  'a', 'button', 'input', 'select', 'textarea', 'label',
]);

// ── Exported functions ───────────────────────────────────────────────────────

/**
 * Extract a simplified DOM tree from the live page.
 * Returned array represents the top-level kept nodes; each may have `children`.
 */
export async function simplifyDOM(page: CapturablePage): Promise<SimplifiedDOMNode[]> {
  return page.evaluate(() => {
    const VIEWPORT_HEIGHT = window.innerHeight;
    const MAX_TEXT = 200;
    const MAX_CHILDREN_BEFORE_COLLAPSE = 5; // collapse runs of >5 identical siblings

    function isHidden(el: Element): boolean {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return true;
      if (el.getAttribute('aria-hidden') === 'true') return true;
      if (el instanceof HTMLElement && el.offsetParent === null && el.tagName !== 'BODY') return true;
      return false;
    }

    function truncate(text: string): string {
      const t = text.replace(/\s+/g, ' ').trim();
      return t.length > MAX_TEXT ? t.slice(0, MAX_TEXT) + '…' : t;
    }

    function getBBox(el: Element) {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
    }

    function getDataAttrs(el: Element): Record<string, string> | undefined {
      const result: Record<string, string> = {};
      for (const attr of Array.from(el.attributes)) {
        if (attr.name.startsWith('data-')) result[attr.name] = attr.value.slice(0, 80);
      }
      return Object.keys(result).length ? result : undefined;
    }

    function isInteractiveTag(tag: string): boolean {
      return ['a', 'button', 'input', 'select', 'textarea', 'label'].includes(tag);
    }

    function isLandmark(tag: string): boolean {
      return ['header', 'nav', 'main', 'footer', 'section', 'article', 'aside', 'h1', 'h2', 'h3', 'form'].includes(tag);
    }

    function shouldDiscard(tag: string): boolean {
      return ['script', 'style', 'noscript', 'head', 'link', 'meta', 'template',
        'iframe', 'object', 'embed', 'applet', 'base'].includes(tag);
    }

    function hasInteractiveDescendant(el: Element): boolean {
      for (const child of Array.from(el.querySelectorAll('a,button,input,select,textarea,[role="button"],[onclick]'))) {
        if (!isHidden(child)) return true;
      }
      return false;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function processNode(el: Element, depth: number): any | null {
      const tag = el.tagName.toLowerCase();

      if (shouldDiscard(tag)) return null;
      if (depth > 12) return null; // prevent runaway recursion
      if (isHidden(el)) return null;

      const isInteractive = isInteractiveTag(tag)
        || el.getAttribute('role') === 'button'
        || el.hasAttribute('onclick');
      const landmark = isLandmark(tag);

      // For non-landmark, non-interactive elements, only keep if they have interactive descendants
      if (!isInteractive && !landmark && depth > 2) {
        if (!hasInteractiveDescendant(el)) return null;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const node: any = { tag };

      if (el.id) node.id = el.id;

      const classes = Array.from(el.classList).slice(0, 6);
      if (classes.length) node.classes = classes;

      const text = el instanceof HTMLElement ? (el.innerText ?? '').trim() : '';
      if (text) node.text_content = truncate(text);

      if (tag === 'a') node.href = (el as HTMLAnchorElement).href || undefined;
      if (tag === 'input') node.type = (el as HTMLInputElement).type;

      const role = el.getAttribute('role');
      if (role) node.role = role;

      const dataAttrs = getDataAttrs(el);
      if (dataAttrs) node.data_attributes = dataAttrs;

      // Bounding box for interactive elements and headings (needed for screenshot annotations)
      if (isInteractive || landmark) {
        node.bounding_box = getBBox(el);
        node.is_above_fold = (node.bounding_box.y + node.bounding_box.height) <= VIEWPORT_HEIGHT;
      }

      // Process children, collapsing repeated sibling patterns
      const childNodes = Array.from(el.children);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const children: any[] = [];
      let i = 0;
      while (i < childNodes.length) {
        const child = childNodes[i];
        const childTag = child.tagName.toLowerCase();
        // Count consecutive same-tag same-class siblings
        let run = 1;
        while (
          i + run < childNodes.length &&
          childNodes[i + run].tagName === child.tagName &&
          childNodes[i + run].className === child.className &&
          run < MAX_CHILDREN_BEFORE_COLLAPSE
        ) run++;

        const processed = processNode(child, depth + 1);
        if (processed) {
          if (run > 1) {
            processed._collapsed_count = run;
            i += run;
          } else {
            i++;
          }
          children.push(processed);
        } else {
          i++;
        }
      }

      if (children.length) node.children = children;

      return node;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any[] = [];
    for (const child of Array.from(document.body?.children ?? [])) {
      const node = processNode(child, 0);
      if (node) result.push(node);
    }
    return result;
  }) as Promise<SimplifiedDOMNode[]>;
}

/**
 * Extract all interactive elements from the page with bounding boxes and selectors.
 */
export async function extractInteractiveElements(page: CapturablePage): Promise<InteractiveElement[]> {
  return page.evaluate(() => {
    const VIEWPORT_HEIGHT = window.innerHeight;
    let counter = 0;

    function isHidden(el: Element): boolean {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return true;
      if (el.getAttribute('aria-hidden') === 'true') return true;
      if (el instanceof HTMLElement && el.offsetParent === null && el.tagName !== 'BODY') return true;
      return false;
    }

    function cssSelector(el: Element): string {
      if (el.id) return `#${CSS.escape(el.id)}`;
      const tag = el.tagName.toLowerCase();
      const classes = Array.from(el.classList).slice(0, 3).map(c => `.${CSS.escape(c)}`).join('');
      const parent = el.parentElement;
      if (!parent || parent === document.body) return `${tag}${classes}`;
      const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
      const idx = siblings.indexOf(el);
      return `${cssSelector(parent)} > ${tag}${classes}${idx > 0 ? `:nth-of-type(${idx + 1})` : ''}`;
    }

    function getParentFormId(el: Element): string | undefined {
      const form = el.closest('form');
      return form ? (form.id || (form as HTMLElement).dataset['atlasFormId']) : undefined;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const elements: any[] = [];

    const candidates = document.querySelectorAll(
      'button, a[href], input[type="submit"], input[type="button"], [role="button"], select, textarea',
    );

    for (const el of Array.from(candidates)) {
      if (isHidden(el)) continue;

      const tag = el.tagName.toLowerCase();
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      const text = (el instanceof HTMLElement ? (el.innerText ?? el.getAttribute('value') ?? el.getAttribute('placeholder') ?? '') : '').trim().slice(0, 120);

      let elementType: string = 'custom';
      if (tag === 'button' || el.getAttribute('role') === 'button') elementType = 'button';
      else if (tag === 'a') elementType = 'link';
      else if (tag === 'input' && (el as HTMLInputElement).type === 'submit') elementType = 'form_submit';
      else if (tag === 'input') elementType = 'input';
      else if (tag === 'select') elementType = 'select';

      const element_id = `elem_${++counter}`;
      // Tag the element in the DOM so form capture can reference it
      (el as HTMLElement).dataset['atlasElemId'] = element_id;

      elements.push({
        element_id,
        tag,
        text,
        selector: cssSelector(el),
        element_type: elementType,
        parent_form_id: getParentFormId(el),
        href: tag === 'a' ? (el as HTMLAnchorElement).href : undefined,
        bounding_box: { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) },
        is_visible: true,
        is_above_fold: (rect.top + rect.height) <= VIEWPORT_HEIGHT,
      });
    }

    return elements;
  }) as Promise<InteractiveElement[]>;
}

/**
 * Extract all forms from the page with their fields.
 */
export async function extractForms(page: CapturablePage): Promise<FormCapture[]> {
  return page.evaluate(() => {
    let formCounter = 0;

    function cssSelector(el: Element): string {
      if (el.id) return `#${CSS.escape(el.id)}`;
      const tag = el.tagName.toLowerCase();
      const parent = el.parentElement;
      if (!parent) return tag;
      const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
      const idx = siblings.indexOf(el);
      return `${tag}${idx > 0 ? `:nth-of-type(${idx + 1})` : ''}`;
    }

    function getLabelText(input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): string {
      // Check associated label via id
      if (input.id) {
        const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
        if (label) return (label.textContent ?? '').trim().slice(0, 80);
      }
      // Check parent label
      const parentLabel = input.closest('label');
      if (parentLabel) return (parentLabel.textContent ?? '').trim().slice(0, 80);
      // Check aria-label
      return input.getAttribute('aria-label') ?? input.getAttribute('placeholder') ?? '';
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const forms: any[] = [];

    for (const form of Array.from(document.querySelectorAll('form'))) {
      const formId = form.id || `atlas_form_${++formCounter}`;
      if (!form.id) (form as HTMLElement).dataset['atlasFormId'] = formId;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fields: any[] = [];
      const inputs = form.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea');

      for (const input of Array.from(inputs)) {
        const el = input as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        fields.push({
          name: el.name || el.id || '',
          type: (el as HTMLInputElement).type || el.tagName.toLowerCase(),
          label: getLabelText(el),
          placeholder: (el as HTMLInputElement).placeholder || undefined,
          required: el.required,
          selector: cssSelector(el),
        });
      }

      const submitBtn = form.querySelector('[type="submit"], button:not([type="button"])');
      const submitRect = submitBtn?.getBoundingClientRect();

      forms.push({
        form_id: formId,
        action: form.action || '',
        method: (form.method || 'get').toUpperCase(),
        selector: cssSelector(form),
        fields,
        submit_button: submitBtn && submitRect ? {
          element_id: (submitBtn as HTMLElement).dataset['atlasElemId'] || `submit_${formId}`,
          tag: submitBtn.tagName.toLowerCase(),
          text: ((submitBtn as HTMLElement).innerText ?? '').trim().slice(0, 80),
          selector: cssSelector(submitBtn),
          element_type: 'form_submit',
          parent_form_id: formId,
          bounding_box: { x: Math.round(submitRect.left), y: Math.round(submitRect.top), width: Math.round(submitRect.width), height: Math.round(submitRect.height) },
          is_visible: true,
          is_above_fold: submitRect.top <= window.innerHeight,
        } : null,
      });
    }

    return forms;
  }) as Promise<FormCapture[]>;
}

// Re-export types for convenience
export type { SimplifiedDOMNode, InteractiveElement, FormCapture, FormField };
