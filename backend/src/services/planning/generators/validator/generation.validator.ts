/**
 * GenerationValidator — pre-delivery linter for Atlas output artefacts.
 *
 * Runs synchronously after rendering, before delivery. All 10 rules must pass
 * or the result carries structured errors. CRITICAL errors block delivery.
 * HIGH errors surface as warnings the user must acknowledge.
 *
 * Rules:
 *   1  VARIABLE_RESOLUTION        — no unresolved {{...}} refs in any GTM tag
 *   2  TAG_NAME_UNIQUENESS         — no two GTM tags share the same name
 *   3  CONSENT_SETTINGS_PRESENT   — all platform tags have consent ≠ notSet
 *   4  EVENT_PARAMETERS_COMPLETENESS — every GA4 event tag maps all declared params
 *   5  SCHEMA_SNIPPET_CONSISTENCY  — spec parameter keys match code snippet keys
 *   6  SELECTOR_VALIDITY           — no :contains() or jQuery pseudo-selectors
 *   7  BUSINESS_TYPE_ISOLATION     — no ecommerce constructs on lead_gen events
 *   8  METADATA_ACCURACY           — counts in guide/metadata match actual content
 *   9  PLACEHOLDER_GUIDE_CONSISTENCY — guide placeholder table matches CONST variables
 *   10 PER_EVENT_CONVERSION_LABELS — each Google Ads tag has its own label variable
 */

import type { GTMContainerJSON, GTMParameter, GTMTagDef, GTMTriggerDef } from '../gtmContainerGenerator';
import type { DataLayerSpecOutput } from '../dataLayerSpecGenerator';
import type { PlanningRecommendation } from '@/types/planning';
import type { ValidationResult, ValidationError, ValidationWarning } from './validator.types';
import {
  ECOMMERCE_ACTION_TYPES,
  ECOMMERCE_PARAM_KEYS,
  PRICE_INDICATOR_REGEX,
  ECOMMERCE_SNIPPET_ACTIONS,
} from '../ir.types';

// ── Constants ─────────────────────────────────────────────────────────────────

/** GTM tag types that are platform measurement tags — must have consent applied. */
const PLATFORM_TAG_TYPES = new Set(['gaawc', 'gaawe', 'awct', 'gclidw']);

/** HTML tag name prefixes that identify platform measurement tags. */
const PLATFORM_HTML_PREFIXES = ['Meta -', 'TikTok -', 'LinkedIn -'];

/** CSS pseudo-selectors that are invalid in GTM trigger filters. */
const INVALID_SELECTOR_FRAGMENTS = [':contains(', ':has-text(', ':text('];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Recursively extract all string `value` fields from a GTM parameter tree. */
function extractParameterValues(params: GTMParameter[]): string[] {
  const results: string[] = [];
  for (const p of params) {
    if (p.value !== undefined && typeof p.value === 'string') results.push(p.value);
    if (p.list) results.push(...extractParameterValues(p.list));
    if (p.map) results.push(...extractParameterValues(p.map));
  }
  return results;
}

/** Extract all {{VariableName}} references from a string. */
function extractVariableRefs(str: string): string[] {
  const refs: string[] = [];
  const pattern = /\{\{([^}]+)\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(str)) !== null) {
    refs.push(match[1]);
  }
  return refs;
}

/**
 * Extract the top-level dataLayer push keys from a code snippet string.
 * Handles the standard Atlas snippet format:
 *   window.dataLayer.push({ event: '...', key1: val, key2: val });
 * Skips 'event' (always present) and nested object sub-keys.
 */
function extractSnippetKeys(snippet: string): Set<string> {
  const keys = new Set<string>();
  const pushIdx = snippet.indexOf('dataLayer.push(');
  if (pushIdx === -1) return keys;

  const braceStart = snippet.indexOf('{', pushIdx);
  if (braceStart === -1) return keys;

  // Walk forward to find the matching closing brace
  let depth = 0;
  let i = braceStart;
  let content = '';
  for (; i < snippet.length; i++) {
    const ch = snippet[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) break;
    }
    content += ch;
  }

  // Match top-level keys: exactly 2 spaces of indent before a word char + colon
  // This excludes nested object sub-keys (which are at 4+ spaces) and comments
  const keyPattern = /^ {2}(\w+)\s*:/gm;
  let m: RegExpExecArray | null;
  while ((m = keyPattern.exec(content)) !== null) {
    const k = m[1];
    if (k !== 'event') keys.add(k);
  }
  return keys;
}

/** Return true if a string contains any invalid CSS pseudo-selector fragment. */
function containsInvalidSelector(value: string): boolean {
  return INVALID_SELECTOR_FRAGMENTS.some(frag => value.includes(frag));
}

/** Return true if the tag should have consent settings applied. */
function isPlatformTag(tag: GTMTagDef): boolean {
  if (PLATFORM_TAG_TYPES.has(tag.type)) return true;
  if (tag.type === 'html') {
    return PLATFORM_HTML_PREFIXES.some(prefix => tag.name.startsWith(prefix));
  }
  return false;
}

// ── Input type ────────────────────────────────────────────────────────────────

export interface GenerationValidationInput {
  gtmContainer: GTMContainerJSON;
  dataLayerSpec: DataLayerSpecOutput;
  /** Markdown string from generateDeveloperHandoffDoc */
  implementationGuide: string;
  recommendations: PlanningRecommendation[];
  businessType: string;
  platforms: string[];
}

// ── Validator ─────────────────────────────────────────────────────────────────

export function validateGeneration(input: GenerationValidationInput): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  const { gtmContainer, dataLayerSpec, implementationGuide, recommendations, businessType, platforms } = input;
  const cv = gtmContainer.containerVersion;
  const { tag: tags, trigger: triggers, variable: variables } = cv;

  // Build known-variable lookup (declared variables + GTM built-ins)
  const variableNames = new Set(variables.map(v => v.name));
  const builtInNames = new Set(cv.builtInVariable.map(b => b.name));
  const allKnownVariables = new Set([...variableNames, ...builtInNames]);

  // ── Rule 1: Variable Resolution ─────────────────────────────────────────────
  // Every {{...}} reference in any tag parameter must resolve to a known variable.
  for (const tag of tags) {
    const values = extractParameterValues(tag.parameter);
    for (const value of values) {
      for (const ref of extractVariableRefs(value)) {
        if (!allKnownVariables.has(ref)) {
          errors.push({
            rule: 'VARIABLE_RESOLUTION',
            severity: 'CRITICAL',
            location: `GTM tag: ${tag.name}`,
            message: `Unresolved variable reference {{${ref}}} — no matching variable exists in the container.`,
            fix_hint: `Create a GTM variable named exactly "${ref}", or update the reference to match an existing variable. Check the variable naming convention: CONST - GA4 Measurement ID, CONST - GAds Conversion Label - {event_name}.`,
          });
        }
      }
    }
  }

  // ── Rule 2: Tag Name Uniqueness ─────────────────────────────────────────────
  const tagNameCounts = new Map<string, number>();
  for (const tag of tags) {
    tagNameCounts.set(tag.name, (tagNameCounts.get(tag.name) ?? 0) + 1);
  }
  for (const [name, count] of tagNameCounts) {
    if (count > 1) {
      errors.push({
        rule: 'TAG_NAME_UNIQUENESS',
        severity: 'HIGH',
        location: `GTM tag: ${name}`,
        message: `Tag name "${name}" appears ${count} times. Duplicate tag names make GTM workspaces unmaintainable and can cause tags to fire incorrectly.`,
        fix_hint: `Include the specific event_name in every tag name, e.g. "GA4 - lead_form_submit" not "GA4 - Form Submission".`,
      });
    }
  }

  // ── Rule 3: Consent Settings Present ────────────────────────────────────────
  // All platform measurement tags must have consentStatus ≠ notSet.
  for (const tag of tags) {
    if (!isPlatformTag(tag)) continue;
    const status = tag.consentSettings?.consentStatus;
    if (!status || status === 'notSet') {
      errors.push({
        rule: 'CONSENT_SETTINGS_PRESENT',
        severity: 'CRITICAL',
        location: `GTM tag: ${tag.name}`,
        message: `Tag "${tag.name}" has consentStatus: notSet. This tag will fire regardless of user consent decisions — a compliance failure.`,
        fix_hint: `Set consentSettings.consentStatus to 'needed'. For GA4 tags, set consentType to ['analytics_storage']. For Google Ads and Meta tags, set consentType to ['ad_storage', 'ad_user_data', 'ad_personalization'].`,
      });
    }
  }

  // ── Rule 4: EventParameters Completeness ────────────────────────────────────
  // Every GA4 event tag (gaawe) must map all parameters declared in its recommendation.
  const recParamsByEvent = new Map<string, Set<string>>();
  for (const rec of recommendations) {
    const paramKeys = new Set(
      (rec.required_params ?? []).map(p => p.param_key).filter(k => k && k.length > 0),
    );
    const existing = recParamsByEvent.get(rec.event_name);
    if (existing) {
      for (const k of paramKeys) existing.add(k);
    } else {
      recParamsByEvent.set(rec.event_name, paramKeys);
    }
  }

  for (const tag of tags) {
    if (tag.type !== 'gaawe') continue;

    const eventNameParam = tag.parameter.find(p => p.key === 'eventName' || p.key === 'eventname');
    const eventName = eventNameParam?.value;
    if (!eventName) continue;

    // Collect keys already mapped in this tag's eventParameters
    const mappedKeys = new Set<string>();
    const eventParamsList = tag.parameter.find(p => p.key === 'eventParameters');
    if (eventParamsList?.list) {
      for (const item of eventParamsList.list) {
        if (item.map) {
          const keyEntry = item.map.find(m => m.key === 'key');
          if (keyEntry?.value) mappedKeys.add(keyEntry.value);
        }
      }
    }

    const expectedKeys = recParamsByEvent.get(eventName);
    if (!expectedKeys || expectedKeys.size === 0) continue;

    if (mappedKeys.size === 0) {
      errors.push({
        rule: 'EVENT_PARAMETERS_COMPLETENESS',
        severity: 'HIGH',
        location: `GTM tag: ${tag.name}`,
        message: `GA4 event tag "${tag.name}" has no eventParameters mapped, but the event declares ${expectedKeys.size} parameter(s): ${[...expectedKeys].join(', ')}.`,
        fix_hint: `Add an eventParameters MAP entry for each declared parameter. Use DLV - {param_key} as the variable reference, e.g. key="cta_text", value="{{DLV - cta_text}}".`,
      });
    } else {
      for (const expected of expectedKeys) {
        if (!mappedKeys.has(expected)) {
          errors.push({
            rule: 'EVENT_PARAMETERS_COMPLETENESS',
            severity: 'HIGH',
            location: `GTM tag: ${tag.name}`,
            message: `GA4 event tag "${tag.name}" is missing eventParameters mapping for key "${expected}".`,
            fix_hint: `Add MAP entry: key="${expected}", value="{{DLV - ${expected}}}".`,
          });
        }
      }
    }
  }

  // ── Rule 5: Schema/Snippet Consistency ──────────────────────────────────────
  // For non-ecommerce events: parameter keys in the schema must match snippet keys.
  for (const page of dataLayerSpec.machine_spec.pages) {
    for (const event of page.events) {
      // Ecommerce events use a nested ecommerce: object — skip flat key comparison
      if (ECOMMERCE_SNIPPET_ACTIONS.has(event.action_type)) continue;

      // Only check required params — optional params are intentionally absent from the snippet.
      const schemaKeys = new Set(
        event.parameters.filter(p => p.required).map(p => p.key).filter(k => k !== 'event'),
      );
      const snippetKeys = extractSnippetKeys(event.code_snippet);

      for (const k of schemaKeys) {
        if (!snippetKeys.has(k)) {
          errors.push({
            rule: 'SCHEMA_SNIPPET_CONSISTENCY',
            severity: 'CRITICAL',
            location: `DataLayer spec: "${event.event_name}" on ${page.page_url}`,
            message: `Parameter "${k}" is declared in the schema but missing from the code snippet.`,
            fix_hint: `Add "${k}: '{{${k.toUpperCase()}}}'" to the dataLayer.push() call in the code snippet.`,
          });
        }
      }

      for (const k of snippetKeys) {
        if (!schemaKeys.has(k)) {
          errors.push({
            rule: 'SCHEMA_SNIPPET_CONSISTENCY',
            severity: 'CRITICAL',
            location: `DataLayer spec: "${event.event_name}" on ${page.page_url}`,
            message: `Parameter "${k}" appears in the code snippet but is not declared in the schema.`,
            fix_hint: `Either add "${k}" to the event's parameters[] in the schema, or remove it from the code snippet.`,
          });
        }
      }
    }
  }

  // ── Rule 6: Selector Validity ────────────────────────────────────────────────
  // No :contains(), :has-text(), or :text() pseudo-selectors anywhere.
  function checkTriggerFilters(trigger: GTMTriggerDef): void {
    const filterGroups = [trigger.customEventFilter ?? [], trigger.filter ?? []];
    for (const group of filterGroups) {
      for (const condition of group) {
        for (const param of condition.parameter) {
          if (param.value && containsInvalidSelector(param.value)) {
            errors.push({
              rule: 'SELECTOR_VALIDITY',
              severity: 'CRITICAL',
              location: `GTM trigger: ${trigger.name}`,
              message: `Trigger filter contains an invalid CSS pseudo-selector: "${param.value}". GTM triggers never fire when :contains() is used.`,
              fix_hint: `Use trigger_type 'click_text' with the GTM {{Click Text}} built-in and an EQUALS filter instead of :contains("text").`,
            });
          }
        }
      }
    }
  }

  for (const trigger of triggers) {
    checkTriggerFilters(trigger);
  }

  for (const page of dataLayerSpec.machine_spec.pages) {
    for (const event of page.events) {
      if (event.element_selector && containsInvalidSelector(event.element_selector)) {
        errors.push({
          rule: 'SELECTOR_VALIDITY',
          severity: 'CRITICAL',
          location: `DataLayer spec: "${event.event_name}" on ${page.page_url}`,
          message: `element_selector "${event.element_selector}" contains an invalid CSS pseudo-selector.`,
          fix_hint: `Use element_text field with the exact visible text. Set trigger_type to 'click_text' in the IR.`,
        });
      }
    }
  }

  // ── Rule 7: Business Type Isolation ─────────────────────────────────────────
  // No ecommerce constructs (action types, param keys, price examples, ecommerce objects)
  // on lead_gen events.
  if (businessType === 'lead_gen') {
    for (const rec of recommendations) {
      if (ECOMMERCE_ACTION_TYPES.has(rec.action_type)) {
        errors.push({
          rule: 'BUSINESS_TYPE_ISOLATION',
          severity: 'CRITICAL',
          location: `Recommendation: ${rec.event_name}`,
          message: `Event "${rec.event_name}" has action_type "${rec.action_type}" which is ecommerce-only on a lead_gen site.`,
          fix_hint: `Change action_type to one of: page_view, cta_click, form_submit, content_engagement, content_navigation, ui_interaction.`,
        });
      }

      const allParams = [...(rec.required_params ?? []), ...(rec.optional_params ?? [])];
      for (const param of allParams) {
        if (ECOMMERCE_PARAM_KEYS.has(param.param_key)) {
          errors.push({
            rule: 'BUSINESS_TYPE_ISOLATION',
            severity: 'CRITICAL',
            location: `Recommendation: ${rec.event_name} — param: ${param.param_key}`,
            message: `Parameter "${param.param_key}" is an ecommerce-only field on a lead_gen site.`,
            fix_hint: `Remove "${param.param_key}" from this event. Lead gen events should not contain product or price fields.`,
          });
        }
        if (param.example_value && PRICE_INDICATOR_REGEX.test(param.example_value)) {
          errors.push({
            rule: 'BUSINESS_TYPE_ISOLATION',
            severity: 'HIGH',
            location: `Recommendation: ${rec.event_name} — param: ${param.param_key}`,
            message: `Parameter example value "${param.example_value}" contains a currency symbol on a lead_gen site.`,
            fix_hint: `Use a contextually appropriate example (e.g. form name, button label) — not a price value.`,
          });
        }
      }
    }

    // Check spec code snippets for ecommerce: object
    for (const page of dataLayerSpec.machine_spec.pages) {
      for (const event of page.events) {
        if (event.code_snippet.includes('ecommerce:')) {
          errors.push({
            rule: 'BUSINESS_TYPE_ISOLATION',
            severity: 'CRITICAL',
            location: `DataLayer spec: "${event.event_name}" on ${page.page_url}`,
            message: `Code snippet for "${event.event_name}" contains an ecommerce: object on a lead_gen site.`,
            fix_hint: `Remove the ecommerce object. Lead gen events push flat key-value pairs, not nested ecommerce objects.`,
          });
        }
      }
    }
  }

  // ── Rule 8: Metadata Accuracy ────────────────────────────────────────────────
  // Guide header counts must match actual content.
  const metaPlatforms = [...(dataLayerSpec.metadata.platforms ?? [])].sort().join(',');
  const actualPlatforms = [...platforms].sort().join(',');
  if (metaPlatforms !== actualPlatforms) {
    errors.push({
      rule: 'METADATA_ACCURACY',
      severity: 'HIGH',
      location: 'DataLayer spec: metadata.platforms',
      message: `metadata.platforms [${metaPlatforms}] does not match the session's selected platforms [${actualPlatforms}].`,
      fix_hint: `Derive metadata.platforms directly from session.selected_platforms.`,
    });
  }

  // Check conversion count in the implementation guide header
  const guideConvMatch = implementationGuide.match(/\*\*Conversions:\*\*\s*(\d+)/);
  if (guideConvMatch) {
    const guideConvCount = parseInt(guideConvMatch[1], 10);
    // Conversion actions by event name (current generator's logic)
    const conversionEventNames = new Set(['purchase', 'generate_lead', 'sign_up', 'begin_checkout']);
    const actualConvCount = recommendations.filter(r => conversionEventNames.has(r.event_name)).length;
    if (guideConvCount === 0 && actualConvCount > 0) {
      errors.push({
        rule: 'METADATA_ACCURACY',
        severity: 'HIGH',
        location: 'Implementation guide: Conversions count in header',
        message: `Guide reports "Conversions: 0" but ${actualConvCount} recommendation(s) have conversion event names.`,
        fix_hint: `Derive the conversion count from the action_type field, not by matching event names against a fixed set.`,
      });
    }
  }

  // Also check via action_type directly — guide's count derivation uses event_name which misses custom names
  const conversionActionTypes = new Set(['purchase', 'generate_lead', 'sign_up', 'form_submit', 'begin_checkout']);
  const actionTypeConvCount = recommendations.filter(r => conversionActionTypes.has(r.action_type)).length;
  if (guideConvMatch) {
    const guideConvCount = parseInt(guideConvMatch[1], 10);
    if (guideConvCount === 0 && actionTypeConvCount > 0) {
      warnings.push({
        rule: 'METADATA_ACCURACY',
        location: 'Implementation guide: Conversions count',
        message: `Guide shows "Conversions: 0" but ${actionTypeConvCount} recommendation(s) have conversion action_types. This likely occurs because the event names are custom (not 'generate_lead', 'purchase', etc.).`,
      });
    }
  }

  // ── Rule 9: Placeholder Guide Consistency ────────────────────────────────────
  // CONST variables with placeholder values must all appear in the guide's
  // placeholder table; the guide must not list platforms not in the container.

  // Identify CONST variables that still have placeholder values
  const placeholderConstVars = variables.filter(v => {
    if (v.type !== 'c') return false;
    const valParam = v.parameter.find(p => p.key === 'value');
    const val = valParam?.value ?? '';
    // Placeholder: empty, or all-uppercase/dash pattern, or looks like a stub ID
    return (
      !val ||
      val === '' ||
      /^[A-Z0-9][A-Z0-9_\-]*$/.test(val) ||
      /^(G|AW|GTM)-[X0-9]+/.test(val) ||
      /^[0X]{6,}$/.test(val)
    );
  });

  // Check: Meta Pixel ID in guide but no Meta platform selected
  const hasMeta = platforms.includes('meta');
  const hasMetaVarInContainer = variables.some(v => v.name === 'CONST - Meta Pixel ID');
  if (implementationGuide.includes('Meta Pixel') && !hasMeta && !hasMetaVarInContainer) {
    errors.push({
      rule: 'PLACEHOLDER_GUIDE_CONSISTENCY',
      severity: 'HIGH',
      location: 'Implementation guide: placeholder table',
      message: `Guide mentions "Meta Pixel" placeholder but Meta is not a selected platform and no Meta Pixel variable exists in the container.`,
      fix_hint: `Only include the Meta Pixel placeholder row when 'meta' is in session.selected_platforms.`,
    });
  }

  // Warn about CONST vars that appear to have no documentation in the guide
  // (only check for GAds Conversion Label vars since those are the most commonly missing)
  for (const v of placeholderConstVars) {
    if (v.name.startsWith('CONST - GAds Conversion Label -')) {
      const eventPart = v.name.replace('CONST - GAds Conversion Label - ', '');
      if (!implementationGuide.includes(eventPart) && !implementationGuide.includes(v.name)) {
        warnings.push({
          rule: 'PLACEHOLDER_GUIDE_CONSISTENCY',
          location: `GTM variable: ${v.name}`,
          message: `Variable "${v.name}" requires the developer to fill in a conversion label, but it does not appear in the guide's placeholder table.`,
        });
      }
    }
  }

  // ── Rule 10: Per-Event Conversion Labels ────────────────────────────────────
  // Every Google Ads conversion tag must reference a per-event CONST variable,
  // not a shared or non-existent {{CONVERSION_LABEL}}.
  const conversionTags = tags.filter(t => t.type === 'awct');
  for (const tag of conversionTags) {
    const labelParam = tag.parameter.find(p => p.key === 'conversionLabel');

    if (!labelParam?.value) {
      errors.push({
        rule: 'PER_EVENT_CONVERSION_LABELS',
        severity: 'CRITICAL',
        location: `GTM tag: ${tag.name}`,
        message: `Google Ads conversion tag "${tag.name}" has no conversionLabel parameter. All conversions will be recorded as unknown.`,
        fix_hint: `Add conversionLabel referencing a dedicated variable: {{CONST - GAds Conversion Label - {event_name}}}.`,
      });
      continue;
    }

    const refs = extractVariableRefs(labelParam.value);

    if (refs.length === 0) {
      // Hardcoded literal value instead of a variable reference
      errors.push({
        rule: 'PER_EVENT_CONVERSION_LABELS',
        severity: 'HIGH',
        location: `GTM tag: ${tag.name}`,
        message: `conversionLabel is hardcoded to "${labelParam.value}" rather than a GTM variable reference.`,
        fix_hint: `Use a variable reference: {{CONST - GAds Conversion Label - {event_name}}}. Create a CONST variable per conversion event so each can be configured independently.`,
      });
      continue;
    }

    for (const ref of refs) {
      if (ref === 'CONVERSION_LABEL') {
        errors.push({
          rule: 'PER_EVENT_CONVERSION_LABELS',
          severity: 'CRITICAL',
          location: `GTM tag: ${tag.name}`,
          message: `conversionLabel references {{CONVERSION_LABEL}} — a shared, non-existent variable. All conversion tags with this reference will fire with a null label, recording zero conversions.`,
          fix_hint: `Create a dedicated CONST variable "CONST - GAds Conversion Label - {event_name}" for each conversion event and reference it individually.`,
        });
      } else if (!variableNames.has(ref)) {
        errors.push({
          rule: 'PER_EVENT_CONVERSION_LABELS',
          severity: 'CRITICAL',
          location: `GTM tag: ${tag.name}`,
          message: `conversionLabel references {{${ref}}} but no variable with this exact name exists in the container.`,
          fix_hint: `Create a CONST variable named "${ref}" and leave its value empty for the developer to fill in from Google Ads → Goals → Conversions.`,
        });
      } else if (!ref.startsWith('CONST - GAds Conversion Label -')) {
        warnings.push({
          rule: 'PER_EVENT_CONVERSION_LABELS',
          location: `GTM tag: ${tag.name}`,
          message: `conversionLabel references "{{${ref}}}" which doesn't follow the per-event convention "CONST - GAds Conversion Label - {event_name}". This may work but makes the container harder to maintain.`,
        });
      }
    }
  }

  return {
    passed: errors.filter(e => e.severity === 'CRITICAL').length === 0,
    errors,
    warnings,
  };
}
