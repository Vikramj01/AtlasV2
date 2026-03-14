/**
 * GTM Container Preview
 *
 * Renders an interactive, plain-English tree view of a GTM container JSON file.
 * Shows tags, triggers, and variables grouped by category, with plain-English
 * explanations that non-technical marketers can understand.
 *
 * Also shows an "existing tracking conflict" warning when site detection has
 * already identified tracking scripts on the user's site.
 */

import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { ExistingTrackingQuick } from '@/types/planning';

// ── GTM container shape (subset we need for display) ─────────────────────────

interface GTMTag {
  name: string;
  type: string;
  firingRuleId?: string[];
  parameter?: GTMParameter[];
}

interface GTMTrigger {
  name: string;
  type: string;
  filter?: Array<{ type: string; parameter?: GTMParameter[] }>;
  parameter?: GTMParameter[];
}

interface GTMVariable {
  name: string;
  type: string;
  parameter?: GTMParameter[];
}

interface GTMParameter {
  type: string;
  key: string;
  value?: string;
}

interface GTMContainer {
  containerVersion?: {
    tag?: GTMTag[];
    trigger?: GTMTrigger[];
    variable?: GTMVariable[];
  };
  // Some formats put these at the top level
  tag?: GTMTag[];
  trigger?: GTMTrigger[];
  variable?: GTMVariable[];
}

// ── Business-language descriptions ───────────────────────────────────────────

const TAG_TYPE_LABELS: Record<string, { label: string; why: string }> = {
  ua:     { label: 'Google Analytics (UA)',    why: 'Tracks user behaviour and conversions in Universal Analytics.' },
  ga4:    { label: 'Google Analytics 4',       why: 'Tracks events and conversions in GA4.' },
  gaawe:  { label: 'GA4 Event',                why: 'Sends a specific event to Google Analytics 4.' },
  awct:   { label: 'Google Ads Conversion',    why: 'Reports a conversion to Google Ads so Smart Bidding can optimise.' },
  flc:    { label: 'Conversion Linker',        why: 'Captures ad click IDs (gclid) for accurate Google Ads attribution.' },
  fls:    { label: 'Floodlight',               why: 'Sends conversion data to Display & Video 360 or Campaign Manager.' },
  sp:     { label: 'Meta Pixel',               why: 'Sends purchase or engagement events to Meta for ad optimisation.' },
  html:   { label: 'Custom HTML',              why: 'Runs custom JavaScript code on your site.' },
  img:    { label: 'Custom Image',             why: 'Fires a pixel image to record an event with a third-party system.' },
  '_ga_linker': { label: 'Cross-domain Linker', why: 'Preserves GA session data when users cross between your domains.' },
};

const TRIGGER_TYPE_LABELS: Record<string, string> = {
  pageview:      'Fires on every page load',
  domReady:      'Fires when the page is fully loaded',
  windowLoaded:  'Fires after all page resources finish loading',
  click:         'Fires when a specific element is clicked',
  customEvent:   'Fires on a custom dataLayer event',
  formSubmission:'Fires when a form is submitted',
  historyChange: 'Fires on URL changes (for SPAs)',
  scrollDepth:   'Fires when the user scrolls to a depth',
  elementVisibility: 'Fires when an element becomes visible',
};

const VARIABLE_TYPE_LABELS: Record<string, string> = {
  v:      'Constant — a fixed value',
  j:      'JavaScript Variable — reads from window.*',
  d:      'DOM Element — reads value from page HTML',
  k:      'First-Party Cookie',
  gas:    'Google Analytics Settings',
  gtes:   'Google Tag: Event Settings',
  cjs:    'Custom JavaScript — runs code to produce a value',
  dlv:    'Data Layer Variable — reads from dataLayer',
  ctv:    'Container Version Number',
  e:      'Auto Event Variable — captures click/form data',
  r:      'HTTP Referrer',
  f:      'URL Component',
  smm:    'Lookup Table',
  remm:   'Regex Table',
  aev:    'Auto-Event Variable',
  vtp_name: 'Named Variable',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getTagCategory(tag: GTMTag): string {
  const name = (tag.name ?? '').toLowerCase();
  const type = (tag.type ?? '').toLowerCase();
  if (type === 'flc') return 'Configuration';
  if (type === 'awct' || name.includes('google ads') || name.includes('conversion')) return 'Conversion Events';
  if (type === 'gaawe' || name.includes('purchase') || name.includes('add_to_cart') || name.includes('begin_checkout')) return 'Conversion Events';
  if (type === 'sp' || name.includes('meta') || name.includes('facebook') || name.includes('pixel')) return 'Conversion Events';
  if (type === 'ga4' || type === 'ua' || name.includes('ga4 config') || name.includes('analytics config')) return 'Configuration';
  if (type === 'html' || type === 'img') return 'Custom';
  return 'Engagement Events';
}

function getTagDescription(tag: GTMTag): string {
  const info = TAG_TYPE_LABELS[tag.type?.toLowerCase()] ?? TAG_TYPE_LABELS[tag.type];
  return info?.why ?? 'Custom tag';
}

function getTriggerDescription(trigger: GTMTrigger): string {
  return TRIGGER_TYPE_LABELS[trigger.type] ?? `Fires on: ${trigger.type}`;
}

function getVariableDescription(variable: GTMVariable): string {
  return VARIABLE_TYPE_LABELS[variable.type] ?? variable.type;
}

function groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    const k = key(item);
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {});
}

// ── Sub-components ────────────────────────────────────────────────────────────

function AccordionSection({
  title,
  count,
  icon,
  children,
  defaultOpen = false,
}: {
  title: string;
  count: number;
  icon: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-muted/30 transition-colors"
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          <span>{icon}</span>
          <span>{title}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{count}</span>
        </span>
        <span className={cn('text-xs text-muted-foreground transition-transform', open && 'rotate-180')}>▼</span>
      </button>
      {open && <div className="border-t border-border divide-y divide-border">{children}</div>}
    </div>
  );
}

function ItemRow({ name, description, detail }: { name: string; description: string; detail?: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="px-4 py-2.5">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-start gap-2 text-left"
      >
        <span className="mt-0.5 text-xs text-muted-foreground/60 shrink-0">{expanded ? '▾' : '▸'}</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium truncate">{name}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </button>
      {expanded && detail && (
        <p className="mt-1.5 ml-4 rounded bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {detail}
        </p>
      )}
    </div>
  );
}

// ── Existing tracking conflict warning ────────────────────────────────────────

function ExistingTrackingWarning({
  tracking,
  newTagCount,
  newTriggerCount,
  newVariableCount,
}: {
  tracking: ExistingTrackingQuick;
  newTagCount: number;
  newTriggerCount: number;
  newVariableCount: number;
}) {
  const detected: string[] = [];
  if (tracking.ga4_detected) detected.push(`GA4${tracking.ga4_measurement_id ? ` (${tracking.ga4_measurement_id})` : ''}`);
  if (tracking.gtm_detected) detected.push(`GTM${tracking.gtm_container_id ? ` (${tracking.gtm_container_id})` : ''}`);
  if (tracking.meta_pixel_detected) detected.push('Meta Pixel');
  if (tracking.google_ads_detected) detected.push('Google Ads');

  if (detected.length === 0) return null;

  return (
    <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 p-4 text-xs">
      <p className="mb-2 font-semibold text-blue-800">Your existing setup</p>
      <p className="mb-2 text-blue-700">
        Atlas detected {detected.join(', ')} already on your site.
      </p>
      <p className="mb-1.5 font-medium text-blue-800">When you import this container:</p>
      <ul className="space-y-1 text-blue-700">
        <li>✓ {newTagCount} new tag{newTagCount !== 1 ? 's' : ''} will be added</li>
        <li>✓ {newTriggerCount} new trigger{newTriggerCount !== 1 ? 's' : ''} will be added</li>
        <li>✓ {newVariableCount} new variable{newVariableCount !== 1 ? 's' : ''} will be added</li>
        <li>✓ Nothing existing will be overwritten (Atlas uses unique tag names)</li>
      </ul>
      <p className="mt-2 text-blue-600">
        Tip: Import using "Merge → Rename conflicting" in GTM for safety.
      </p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface GTMContainerPreviewProps {
  containerJson: Record<string, unknown>;
  existingTracking?: ExistingTrackingQuick | null;
}

export function GTMContainerPreview({
  containerJson,
  existingTracking,
}: GTMContainerPreviewProps) {
  const container = containerJson as GTMContainer;

  // Support both top-level and nested containerVersion shapes
  const tags: GTMTag[] = container.containerVersion?.tag ?? container.tag ?? [];
  const triggers: GTMTrigger[] = container.containerVersion?.trigger ?? container.trigger ?? [];
  const variables: GTMVariable[] = container.containerVersion?.variable ?? container.variable ?? [];

  if (tags.length === 0 && triggers.length === 0 && variables.length === 0) {
    return (
      <div className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">
        No container contents detected in the GTM JSON.
      </div>
    );
  }

  const tagsByCategory = groupBy(tags, getTagCategory);
  const categoryOrder = ['Configuration', 'Conversion Events', 'Engagement Events', 'Custom'];

  return (
    <div className="space-y-3">
      {existingTracking && (
        <ExistingTrackingWarning
          tracking={existingTracking}
          newTagCount={tags.length}
          newTriggerCount={triggers.length}
          newVariableCount={variables.length}
        />
      )}

      <p className="text-xs text-muted-foreground">
        What will be created when you import this file into Google Tag Manager:
      </p>

      {/* Tags by category */}
      {categoryOrder.map((category) => {
        const categoryTags = tagsByCategory[category];
        if (!categoryTags?.length) return null;
        const icons: Record<string, string> = {
          'Configuration': '⚙️',
          'Conversion Events': '🎯',
          'Engagement Events': '📊',
          'Custom': '🔧',
        };
        return (
          <AccordionSection
            key={category}
            title={`${category} Tags`}
            count={categoryTags.length}
            icon={icons[category] ?? '📌'}
            defaultOpen={category === 'Conversion Events'}
          >
            {categoryTags.map((tag, idx) => (
              <ItemRow
                key={idx}
                name={tag.name}
                description={getTagDescription(tag)}
                detail={`Tag type: ${tag.type}`}
              />
            ))}
          </AccordionSection>
        );
      })}

      {/* Triggers */}
      {triggers.length > 0 && (
        <AccordionSection title="Triggers" count={triggers.length} icon="⚡">
          {triggers.map((trigger, idx) => (
            <ItemRow
              key={idx}
              name={trigger.name}
              description={getTriggerDescription(trigger)}
            />
          ))}
        </AccordionSection>
      )}

      {/* Variables */}
      {variables.length > 0 && (
        <AccordionSection title="Variables" count={variables.length} icon="📦">
          {variables.map((variable, idx) => (
            <ItemRow
              key={idx}
              name={variable.name}
              description={getVariableDescription(variable)}
            />
          ))}
        </AccordionSection>
      )}

      <p className="text-xs text-muted-foreground/60">
        {tags.length} tag{tags.length !== 1 ? 's' : ''} · {triggers.length} trigger{triggers.length !== 1 ? 's' : ''} · {variables.length} variable{variables.length !== 1 ? 's' : ''}
      </p>
    </div>
  );
}
