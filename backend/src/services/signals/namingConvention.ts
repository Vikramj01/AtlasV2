/**
 * Naming Convention Engine
 *
 * Pure validation and transformation functions — no DB calls.
 * Consumed by the naming convention API route and the taxonomy route
 * when creating custom events.
 */

import type { NamingConvention, ValidationResult } from '../../types/taxonomy';

export const DEFAULT_CONVENTION: NamingConvention = {
  organization_id: '',
  event_case: 'snake_case',
  param_case: 'snake_case',
  event_prefix: null,
  param_prefix: null,
  word_separator: '_',
  max_event_name_length: 40,
  max_param_key_length: 40,
  allowed_characters: 'a-z0-9_',
  reserved_words: ['event', 'page_view', 'session_start', 'first_visit', 'user_engagement'],
  example_event: 'add_to_cart',
  example_param: 'transaction_id',
};

// ─── Public API ───────────────────────────────────────────────────────────────

export function validateEventName(
  name: string,
  convention: NamingConvention,
): ValidationResult {
  const errors: string[] = [];
  const suggestions: string[] = [];

  if (name !== name.trim()) {
    errors.push('Event name has leading or trailing whitespace');
    suggestions.push(name.trim());
  }

  if (name.includes(' ')) {
    errors.push('Event names cannot contain spaces');
    suggestions.push(name.replace(/\s+/g, convention.word_separator));
  }

  if (/^\d/.test(name)) {
    errors.push('Event name cannot start with a number');
  }

  if (name.length > convention.max_event_name_length) {
    errors.push(`Event name exceeds ${convention.max_event_name_length} characters (${name.length})`);
  }

  const charRegex = new RegExp(`^[${convention.allowed_characters}]+$`);
  if (!charRegex.test(name)) {
    errors.push(`Contains characters not in allowed set: [${convention.allowed_characters}]`);
    const cleaned = name.replace(new RegExp(`[^${convention.allowed_characters}]`, 'g'), convention.word_separator);
    suggestions.push(cleaned);
  }

  if (!matchesCase(name, convention.event_case)) {
    errors.push(`Event name should be ${convention.event_case}`);
    suggestions.push(convertCase(name, convention.event_case, convention.word_separator));
  }

  if (convention.event_prefix && !name.startsWith(convention.event_prefix)) {
    errors.push(`Event name must start with prefix "${convention.event_prefix}"`);
    suggestions.push(`${convention.event_prefix}${name}`);
  }

  const nameWithoutPrefix = convention.event_prefix
    ? name.replace(new RegExp(`^${escapeRegex(convention.event_prefix)}`), '')
    : name;
  if (convention.reserved_words.includes(nameWithoutPrefix)) {
    errors.push(`"${nameWithoutPrefix}" is a reserved event name (auto-collected by GA4)`);
  }

  return {
    valid: errors.length === 0,
    errors,
    suggestions: [...new Set(suggestions)],
  };
}

export function validateParamKey(
  key: string,
  convention: NamingConvention,
): ValidationResult {
  const errors: string[] = [];
  const suggestions: string[] = [];

  if (key.length > convention.max_param_key_length) {
    errors.push(`Parameter key exceeds ${convention.max_param_key_length} characters (${key.length})`);
  }

  const charRegex = new RegExp(`^[${convention.allowed_characters}]+$`);
  if (!charRegex.test(key)) {
    errors.push(`Contains characters not in allowed set: [${convention.allowed_characters}]`);
  }

  if (!matchesCase(key, convention.param_case)) {
    errors.push(`Parameter key should be ${convention.param_case}`);
    suggestions.push(convertCase(key, convention.param_case, convention.word_separator));
  }

  if (convention.param_prefix && !key.startsWith(convention.param_prefix)) {
    errors.push(`Parameter key must start with prefix "${convention.param_prefix}"`);
    suggestions.push(`${convention.param_prefix}${key}`);
  }

  return { valid: errors.length === 0, errors, suggestions: [...new Set(suggestions)] };
}

/**
 * Converts a taxonomy slug to a correctly-cased event name for an org's convention.
 * e.g. 'add_to_cart' + camelCase → 'addToCart'
 *      'add_to_cart' + prefix 'acme_' → 'acme_add_to_cart'
 */
export function generateEventName(
  taxonomySlug: string,
  convention: NamingConvention,
): string {
  let name = convertCase(taxonomySlug, convention.event_case, convention.word_separator);
  if (convention.event_prefix) {
    name = convention.event_prefix + name;
  }
  return name;
}

/**
 * Builds example_event and example_param strings for display in the settings UI.
 */
export function buildExamples(convention: NamingConvention): { example_event: string; example_param: string } {
  const example_event = generateEventName('add_to_cart', convention);
  let example_param = convertCase('transaction_id', convention.param_case, convention.word_separator);
  if (convention.param_prefix) {
    example_param = convention.param_prefix + example_param;
  }
  return { example_event, example_param };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function matchesCase(str: string, format: NamingConvention['event_case']): boolean {
  switch (format) {
    case 'snake_case':  return /^[a-z0-9]+(_[a-z0-9]+)*$/.test(str);
    case 'camelCase':   return /^[a-z][a-zA-Z0-9]*$/.test(str);
    case 'kebab-case':  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(str);
    case 'PascalCase':  return /^[A-Z][a-zA-Z0-9]*$/.test(str);
  }
}

function convertCase(
  str: string,
  target: NamingConvention['event_case'],
  separator: string,
): string {
  const words = str
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-\s]+/g, ' ')
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  switch (target) {
    case 'snake_case':  return words.join('_');
    case 'camelCase':   return words[0] + words.slice(1).map(w => w[0].toUpperCase() + w.slice(1)).join('');
    case 'kebab-case':  return words.join('-');
    case 'PascalCase':  return words.map(w => w[0].toUpperCase() + w.slice(1)).join('');
    default:            return words.join(separator);
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
