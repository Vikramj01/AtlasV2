/**
 * Trigger Renderer — deterministically produces GTM trigger definitions from IR.
 *
 * Rules:
 *   - click_text   → Click trigger with {{Click Text}} EQUALS filter (no :contains())
 *   - click_css    → Click trigger with {{Click Element}} matches CSS filter
 *   - click_url    → Click trigger with {{Click URL}} CONTAINS filter
 *   - form_submit  → Form Submit trigger (optionally filtered by CSS selector)
 *   - page_load    → Custom Event trigger (developer pushes on page load)
 *   - custom_event → Custom Event trigger
 *   - scroll_depth → Scroll Depth trigger
 */

import type { IRTrigger } from '../ir.types';
import type { GTMTriggerDef, GTMParameter } from '../gtmContainerGenerator';

// ── Helpers ───────────────────────────────────────────────────────────────────

function tmpl(key: string, value: string): GTMParameter {
  return { type: 'TEMPLATE', key, value };
}
function bool(key: string, value: string): GTMParameter {
  return { type: 'BOOLEAN', key, value };
}
function int(key: string, value: string): GTMParameter {
  return { type: 'INTEGER', key, value };
}

function stub(accountId = '0', containerId = '0') {
  return { accountId, containerId, fingerprint: '0', tagManagerUrl: 'https://tagmanager.google.com/' };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Render a GTM trigger definition from an IR trigger descriptor.
 *
 * For page_load and custom_event the name is "CE - {eventName}" and the
 * trigger fires when that custom event enters the dataLayer. All click- and
 * form-based trigger types produce the corresponding GTM native trigger type.
 */
export function renderGTMTrigger(
  trigger: IRTrigger,
  eventName: string,
  triggerId: string,
  folderId: string,
  accountId = '0',
  containerId = '0',
): GTMTriggerDef {
  const base = { ...stub(accountId, containerId), triggerId, folderId };

  switch (trigger.trigger_type) {
    case 'page_load':
    case 'custom_event': {
      // Developer pushes window.dataLayer.push({ event: eventName, ... })
      // GTM listens via a Custom Event trigger matching the event name.
      return {
        ...base,
        name: `CE - ${eventName}`,
        type: 'CUSTOM_EVENT',
        customEventFilter: [{
          type: 'EQUALS',
          parameter: [tmpl('arg0', '{{Event}}'), tmpl('arg1', eventName)],
        }],
      };
    }

    case 'click_text': {
      // Uses the {{Click Text}} GTM built-in — no :contains() needed.
      const clickText = trigger.click_text ?? '';
      return {
        ...base,
        name: `Click - ${eventName}`,
        type: 'CLICK',
        filter: [{
          type: 'EQUALS',
          parameter: [tmpl('arg0', '{{Click Text}}'), tmpl('arg1', clickText)],
        }],
      };
    }

    case 'click_css': {
      const selector = trigger.selector ?? '';
      return {
        ...base,
        name: `Click - ${eventName}`,
        type: 'CLICK',
        filter: [{
          type: 'CSS_SELECTOR',
          parameter: [tmpl('arg0', '{{Click Element}}'), tmpl('arg1', selector)],
        }],
      };
    }

    case 'click_url': {
      const pattern = trigger.click_url_pattern ?? '';
      return {
        ...base,
        name: `Click URL - ${eventName}`,
        type: 'CLICK',
        filter: [{
          type: 'CONTAINS',
          parameter: [tmpl('arg0', '{{Click URL}}'), tmpl('arg1', pattern)],
        }],
      };
    }

    case 'form_submit': {
      const selector = trigger.selector;
      const def: GTMTriggerDef = {
        ...base,
        name: `Form - ${eventName}`,
        type: 'FORM_SUBMISSION',
      };
      if (selector) {
        def.filter = [{
          type: 'CSS_SELECTOR',
          parameter: [tmpl('arg0', '{{Click Element}}'), tmpl('arg1', selector)],
        }];
      }
      return def;
    }

    case 'scroll_depth': {
      return {
        ...base,
        name: `Scroll - ${eventName}`,
        type: 'SCROLL_DEPTH',
        parameter: [
          bool('verticalThresholdsPercent', 'true'),
          tmpl('verticalThresholds', '25,50,75,90'),
          bool('horizontalThresholdsPercent', 'false'),
          bool('orCondition', 'false'),
        ],
      } as GTMTriggerDef;
    }

    default: {
      // Fallback: custom event trigger
      return {
        ...base,
        name: `CE - ${eventName}`,
        type: 'CUSTOM_EVENT',
        customEventFilter: [{
          type: 'EQUALS',
          parameter: [tmpl('arg0', '{{Event}}'), tmpl('arg1', eventName)],
        }],
      };
    }
  }
}

/**
 * Render a human-readable trigger comment for use in code snippets and guides.
 * Distinguishes click_text from click_css; never outputs :contains().
 */
export function renderTriggerComment(trigger: IRTrigger): string {
  switch (trigger.trigger_type) {
    case 'page_load':
      return 'Fire on page load (before GTM snippet)';
    case 'click_text':
      return `Fire when user clicks element with text: "${trigger.click_text ?? ''}"`;
    case 'click_css':
      return `Fire when user clicks: ${trigger.selector ?? '(selector)'}`;
    case 'click_url':
      return `Fire when user clicks link containing: ${trigger.click_url_pattern ?? '(pattern)'}`;
    case 'form_submit':
      return trigger.selector
        ? `Fire on form submit: ${trigger.selector}`
        : 'Fire on any form submission';
    case 'custom_event':
      return 'Fire when this custom event enters the dataLayer';
    case 'scroll_depth':
      return 'Fire at scroll depth thresholds: 25%, 50%, 75%, 90%';
    default:
      return 'Fire on trigger';
  }
}

// Suppress unused import warnings for int/bool — they may be needed for scroll_depth
void int;
void bool;
