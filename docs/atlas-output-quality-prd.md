# PRD: Atlas Output Generation — Quality & Correctness Overhaul

**Product:** Atlas (Spi3l LLC)  
**Author:** Vikram Jeyaratnam  
**Status:** Ready for Implementation  
**Priority:** P0 — Blocks client delivery  
**Scope:** Backend output generation pipeline (Express API)

---

## 1. Background

Atlas generates three artefacts for every client implementation:

1. `atlas-datalayer_spec.json` — machine-readable event schema + code snippets
2. `atlas-gtm_container.json` — importable GTM container with tags, triggers, and variables
3. `atlas-implementation_guide.md` — developer handoff document

An audit of live output for a lead-gen client (NLCS Singapore) identified **14 distinct failure categories** across all three artefacts. The failures range from silent breakage (conversion tags that never fire) to compliance gaps (Consent Mode v2 infrastructure that doesn't actually gate any tags) to semantic errors (ecommerce schemas on a school website with no products).

The root cause is architectural: the current generator lets the LLM produce both the data and the output artefacts in a single pass. This causes drift between fields within the same JSON object, context bleed across business types, and no layer to catch failures before they reach the client.

The fix is a three-layer pipeline:

```
[LLM] → Structured Intermediate Representation (IR)
     → Deterministic Renderer (artefact generation)
     → GenerationValidator (pre-delivery linter)
```

This PRD specifies all three layers plus the schema changes required to support them.

---

## 2. Problem Statement

Current Atlas output has the following confirmed failures:

| # | Failure | Impact |
|---|---|---|
| 1 | Spec parameters contradict code snippets in same JSON object | Developer implements wrong tracking |
| 2 | `form_id` populated with CSS selector string, not runtime value | GA4/Ads receives selector as dimension value |
| 3 | Ecommerce object schema on lead_gen site events | Pollutes GA4 ecommerce reports; confuses client |
| 4 | `{{CONVERSION_LABEL}}` is an unresolved, non-existent variable | All Ads conversion tags fire with null label — zero conversions recorded |
| 5 | GA4 Config tag references `{{GA4_MEASUREMENT_ID}}`, variable named `CONST - GA4 Measurement ID` | GA4 never loads |
| 6 | Every tag has `consentStatus: 'notSet'` | Tags fire regardless of user consent — compliance failure |
| 7 | Three GA4 tags and three Ads tags share identical names | GTM workspace unmaintainable |
| 8 | `banner_carousel_navigation`, `logo_click` send zero eventParameters to GA4 | Events arrive in GA4 as bare names with no dimensions |
| 9 | Meta infrastructure (FBCLID, FBP tags) included when Meta is not in platforms | Dead code; confuses developer |
| 10 | `:contains()` pseudo-selectors in GTM triggers | Triggers never fire; `:contains()` is not valid CSS |
| 11 | `gclid` marked required on `page_view` | Spec validation fails for all non-paid traffic |
| 12 | `generate_lead` standard GA4 event never emitted | Smart Bidding and PMax cannot optimise |
| 13 | Consent Mode v2 push uses `analytics`/`ads` keys | Update event ignored — wrong key names |
| 14 | Metadata counts (`Conversions: 0`) don't match artefact content | Client-facing header is wrong |
| 15 | Implementation guide placeholder table is hardcoded, not derived | CONVERSION_LABEL never mentioned; Pixel ID listed when no Pixel tag exists |

---

## 3. Goals

- **G1:** No Atlas output artefact reaches a user with an unresolved `{{...}}` variable reference.
- **G2:** All three artefact files are internally consistent — the same event has the same parameters in the spec, the code snippet, the GTM tag, and the implementation guide.
- **G3:** Business type isolation — no ecommerce constructs appear in lead_gen output.
- **G4:** Every GA4/Google Ads/Meta tag has correct consent settings applied.
- **G5:** All GTM trigger selectors use valid CSS3 or GTM built-in variable filters.
- **G6:** Every Google Ads conversion tag has a dedicated, correctly named conversion label variable.
- **G7:** Standard GA4 events (`generate_lead`, `purchase`, `sign_up`) are aliased where relevant.
- **G8:** Enhanced Conversions are configured by default on all Google Ads conversion tags.
- **G9:** Implementation guide placeholder table is fully derived from artefact content.
- **G10:** Metadata counts are fully derived from artefact content.

---

## 4. Non-Goals

- Server-side GTM container generation (separate PRD)
- Meta Conversions API (CAPI Module PRD exists separately)
- TikTok, LinkedIn, Snapchat platform support
- Retroactive correction of previously generated client files

---

## 5. Architecture

### 5.1 Current State (problematic)

```
User Input → LLM prompt → [spec JSON] + [GTM JSON] + [guide MD]
             (single pass, no validation, LLM handles all logic)
```

### 5.2 Target State

```
User Input
    │
    ▼
[LLM] → Intermediate Representation (IR)
             │
             ├── ir.events[]
             ├── ir.platforms[]
             ├── ir.business_type
             ├── ir.triggers[]
             └── ir.site_metadata{}
             │
    ▼
[DeterministicRenderer]
    │
    ├── renderDataLayerSpec(ir)  → datalayer_spec.json
    ├── renderGTMContainer(ir)   → gtm_container.json
    └── renderImplementationGuide(ir) → implementation_guide.md
             │
    ▼
[GenerationValidator]
    │
    ├── PASS → deliver to user
    └── FAIL → return structured errors → surface in Atlas UI
```

The LLM's job is narrowed to: classify events, infer selectors, write business justifications. All JSON structure, all variable references, all tag configuration is produced deterministically from the IR. The LLM never writes raw JSON for the output artefacts.

---

## 6. Module Specifications

---

### Module A: Intermediate Representation (IR) Schema

All downstream modules operate on the IR. The IR is produced by the LLM but validated against this schema before rendering begins.

#### 6.A.1 IR Schema Definition

```typescript
interface AtlasIR {
  metadata: IRMetadata;
  events: IREvent[];
  platforms: Platform[];          // 'ga4' | 'google_ads' | 'meta' | 'tiktok'
  business_type: BusinessType;    // 'lead_gen' | 'ecommerce' | 'saas' | 'content'
  site: IRSiteMetadata;
  traffic_source: IRTrafficSource;
}

interface IRMetadata {
  generated_at: string;           // ISO 8601
  atlas_spec_version: string;
  site_url: string;
}

interface IREvent {
  event_id: string;               // 'atlas_evt_001' etc. — auto-assigned by renderer
  event_name: string;             // snake_case
  business_justification: string; // LLM-authored
  action_type: ActionType;        // See 6.A.2
  priority: 'required' | 'recommended' | 'optional';
  platforms: Platform[];
  parameters: IRParameter[];
  attribution?: IRAttribution;    // For events that should capture click IDs
  standard_event_alias?: string;  // e.g. 'generate_lead' — rendered as second tag
  trigger: IRTrigger;
  is_conversion: boolean;
}

interface IRParameter {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required: boolean;
  value_source: IRValueSource;
  example: string;                // Must be contextually correct (never ecommerce example on lead_gen)
}

interface IRValueSource {
  strategy: 'element_text' | 'element_attribute' | 'page_url' |
            'parent_context' | 'developer_provided' | 'runtime_computed';
  attribute?: string;             // e.g. 'id', 'href', 'data-form-id'
  selector?: string;              // Valid CSS3 only — used for trigger, never for value
}

interface IRTrigger {
  trigger_type: 'page_load' | 'click_css' | 'click_text' | 'click_url' |
                'form_submit' | 'custom_event' | 'scroll_depth';
  // Use click_css for selector-based clicks (class, id, attribute)
  // Use click_text for text-content-based clicks (replaces :contains())
  // Use click_url for href-based clicks
  selector?: string;              // Valid CSS3 only — required for click_css, form_submit
  click_text?: string;            // Exact text — required for click_text
  click_url_pattern?: string;     // Substring or regex — required for click_url
}

interface IRAttribution {
  // Attribution parameters live here, NOT in IRParameter[]
  // They are optional by definition — never marked required
  capture_gclid: boolean;
  capture_fbclid: boolean;
  capture_gbraid: boolean;
  capture_wbraid: boolean;
}

type ActionType =
  // Lead gen safe
  | 'page_view' | 'cta_click' | 'form_submit' | 'content_engagement'
  | 'content_navigation' | 'ui_interaction'
  // Ecommerce only — renderer throws if these appear on business_type: lead_gen
  | 'view_item' | 'view_item_list' | 'add_to_cart' | 'purchase' | 'begin_checkout';
```

#### 6.A.2 Business-Type Action Type Allowlist

The renderer enforces this mapping. Any action_type not in the allowlist for the current `business_type` must throw a validation error before rendering.

| action_type | lead_gen | ecommerce | saas | content |
|---|---|---|---|---|
| page_view | ✓ | ✓ | ✓ | ✓ |
| cta_click | ✓ | ✓ | ✓ | ✓ |
| form_submit | ✓ | ✓ | ✓ | ✓ |
| content_engagement | ✓ | ✓ | ✓ | ✓ |
| content_navigation | ✓ | ✓ | ✓ | ✓ |
| ui_interaction | ✓ | ✓ | ✓ | ✓ |
| view_item | ✗ | ✓ | ✗ | ✗ |
| view_item_list | ✗ | ✓ | ✗ | ✗ |
| add_to_cart | ✗ | ✓ | ✗ | ✗ |
| purchase | ✗ | ✓ | ✗ | ✗ |
| begin_checkout | ✗ | ✓ | ✗ | ✗ |

#### 6.A.3 Standard Event Alias Mapping

For `business_type: lead_gen`, the LLM must populate `standard_event_alias` on conversion events. The renderer uses this to generate a second GA4 tag alongside the custom event tag.

| event pattern | standard_event_alias |
|---|---|
| Any event with `is_conversion: true` | `generate_lead` |
| Form submission events | `generate_lead` |

For `business_type: ecommerce`, use `purchase`, `add_to_cart`, etc. per GA4 spec.

---

### Module B: DeterministicRenderer

The renderer takes the IR and produces all three artefacts. It must not call the LLM. All output is computed from the IR.

#### 6.B.1 DataLayer Spec Renderer

**Code snippet generation** must be a template function, never LLM-authored:

```typescript
function renderCodeSnippet(event: IREvent): string {
  const params = event.parameters.map(p => {
    const placeholder = `'{{${p.key.toUpperCase()}}}'`;
    return `  ${p.key}: ${placeholder}`;
  });

  const triggerComment = renderTriggerComment(event.trigger);
  const jsDoc = renderJsDoc(event);

  return [
    `// ${triggerComment}`,
    jsDoc,
    `window.dataLayer = window.dataLayer || [];`,
    `window.dataLayer.push({`,
    `  event: '${event.event_name}',`,
    ...params,
    `});`,
  ].join('\n');
}
```

The placeholder format `{{PARAM_KEY}}` is used consistently and is documented in the implementation guide's variable naming guide. These are not GTM variable references — they are implementation placeholders for the developer. The implementation guide must include a note clarifying this distinction.

**Trigger comment generation** must not embed the selector as a value:

```typescript
function renderTriggerComment(trigger: IRTrigger): string {
  switch (trigger.trigger_type) {
    case 'page_load': return 'Trigger: on page load';
    case 'click_css': return `Trigger: click on "${trigger.selector}"`;
    case 'click_text': return `Trigger: click on element with text "${trigger.click_text}"`;
    case 'click_url': return `Trigger: click on link matching "${trigger.click_url_pattern}"`;
    case 'form_submit': return `Trigger: on submit of "${trigger.selector}"`;
    default: return `Trigger: ${trigger.trigger_type}`;
  }
}
```

**Value source rendering** — how the developer should populate each parameter:

```typescript
function renderValueSourceNote(param: IRParameter): string {
  const src = param.value_source;
  switch (src.strategy) {
    case 'element_attribute':
      return `// Read from element: document.querySelector('${src.selector}').getAttribute('${src.attribute}')`;
    case 'element_text':
      return `// Read from element text: document.querySelector('${src.selector}').innerText.trim()`;
    case 'page_url':
      return `// Read from URL: new URLSearchParams(location.search).get('${param.key}')`;
    case 'developer_provided':
      return `// Provided by your application at runtime`;
    case 'runtime_computed':
      return `// Computed at event time — see implementation notes`;
    default:
      return `// Source: ${src.strategy}`;
  }
}
```

**Attribution parameters** must be rendered in a separate block, never inside the main `dataLayer.push()` parameters:

```typescript
function renderAttributionSnippet(): string {
  return `
// Atlas attribution — these are captured automatically by the GTM container.
// You do not need to push these manually unless you are implementing without GTM.
// const gclid = new URLSearchParams(location.search).get('gclid');
// const fbclid = new URLSearchParams(location.search).get('fbclid');
`.trim();
}
```

#### 6.B.2 GTM Container Renderer

**Variable naming convention** — one convention, enforced throughout. All generated variables use the prefix scheme below:

| Variable type | Naming pattern | Example |
|---|---|---|
| DataLayer variable | `DLV - {key}` | `DLV - form_id` |
| URL query | `URL Query - {param}` | `URL Query - gclid` |
| First-party cookie | `1P Cookie - {name}` | `1P Cookie - _gcl_aw` |
| Constant | `CONST - {purpose}` | `CONST - GA4 Measurement ID` |
| Custom JS | `CJS - {purpose}` | `CJS - SHA256 Hash` |
| Built-in | Use GTM built-in name | `{{Click Text}}`, `{{Page URL}}` |

All tag parameters that reference variables must use the exact display name in curly braces matching this convention. No other format is permitted.

**GA4 Config tag variable reference** must use:
```
measurementId: {{CONST - GA4 Measurement ID}}
```
Not `{{GA4_MEASUREMENT_ID}}` or any other format.

**Per-event conversion label variables** — for each event where `is_conversion: true` and `platforms` includes `google_ads`, generate a dedicated CONST variable:

```
Variable name: CONST - GAds Conversion Label - {event_name}
Variable type: CONST (constant)
Value: (empty — developer fills in)
```

The Google Ads conversion tag for that event references this variable:
```
conversionLabel: {{CONST - GAds Conversion Label - {event_name}}}
```

Never use a single shared `{{CONVERSION_LABEL}}` variable.

**Tag naming convention** — all generated tags must follow:

```
{Platform} - {event_name}                      → GA4 event tags
{Platform} - {event_name} Conversion           → Google Ads conversion tags
{Platform} - {event_name}                      → Meta event tags
Atlas - {purpose}                              → utility/infrastructure tags
```

Examples:
```
GA4 - lead_form_submit
Google Ads - lead_form_submit Conversion
GA4 - banner_carousel_navigation
Atlas - Consent Mode v2 Default
Atlas - Click ID Cookie Capture
```

No human-readable abstractions ("People fill out a form here"). No shared names between events.

**Consent settings** — every platform tag must have `consentSettings` applied at generation time. Never `notSet`.

```typescript
function getConsentSettings(platform: Platform, tagType: string): ConsentSettings {
  if (platform === 'ga4') {
    return {
      consentStatus: 'needed',
      consentType: ['analytics_storage']
    };
  }
  if (platform === 'google_ads' || platform === 'meta') {
    return {
      consentStatus: 'needed',
      consentType: ['ad_storage', 'ad_user_data', 'ad_personalization']
    };
  }
  // Infrastructure/utility tags (consent capture, cookie writers)
  return { consentStatus: 'notRequired' };
}
```

**EventParameters mapping** — every GA4 event tag must map all parameters declared in the IR event:

```typescript
function renderGA4EventParameters(event: IREvent): GTMParameterMap[] {
  return event.parameters.map(param => ({
    map: [
      { key: 'key', type: 'TEMPLATE', value: param.key },
      { key: 'value', type: 'TEMPLATE', value: `{{DLV - ${param.key}}}` }
    ],
    type: 'MAP'
  }));
}
```

No event is exempt. `banner_carousel_navigation`, `logo_click`, and all other non-conversion events receive the same treatment.

**Standard event alias tags** — when `event.standard_event_alias` is set, generate a second GA4 event tag:

```
Tag name: GA4 - {standard_event_alias} (alias of {event_name})
Event name: {standard_event_alias}          // e.g. 'generate_lead'
Firing trigger: CE - {event_name}           // same trigger as the custom event
```

Both tags fire on the same custom event trigger. The custom event populates GA4 for reporting. The standard event populates GA4 for Smart Bidding/PMax eligibility.

**Enhanced Conversions** — every Google Ads conversion tag (`awct` type) must include:

```typescript
function renderGoogleAdsConversionTag(event: IREvent): GTMTag {
  return {
    type: 'awct',
    name: `Google Ads - ${event.event_name} Conversion`,
    parameter: [
      { key: 'conversionId', value: '{{CONST - Google Ads Conversion ID}}' },
      { key: 'conversionLabel', value: `{{CONST - GAds Conversion Label - ${event.event_name}}}` },
      { key: 'enhancedConversionsEnabled', value: 'true' },
      // Enhanced Conversions user data mapping
      { key: 'userDataEmail', value: '{{DLV - user_data.email}}' },
      { key: 'userDataPhoneNumber', value: '{{DLV - user_data.phone_number}}' },
    ],
    consentSettings: getConsentSettings('google_ads', 'awct'),
    firingTriggerId: [getTriggerIdForEvent(event.event_name)]
  };
}
```

Add `DLV - user_data.email` and `DLV - user_data.phone_number` to the standard variable set for all containers that include `google_ads` in platforms. These are always generated; they carry data only when the developer populates them.

**Platform-conditional infrastructure** — only generate infrastructure tags for platforms present in `ir.platforms[]`:

```typescript
function renderInfrastructureTags(ir: AtlasIR): GTMTag[] {
  const tags: GTMTag[] = [];

  // Always included
  tags.push(renderConsentModeDefaultTag());
  tags.push(renderConsentModeUpdateTag());
  tags.push(renderClickIdCookieCaptureTag());
  tags.push(renderTrafficSourceCaptureTag());

  // GA4 always included if 'ga4' in platforms
  if (ir.platforms.includes('ga4')) {
    tags.push(renderGA4ConfigTag());
    tags.push(renderConversionLinkerTag());
  }

  // Meta infrastructure only if 'meta' in platforms
  if (ir.platforms.includes('meta')) {
    tags.push(renderMetaPixelBaseTag());
    tags.push(renderFBCLIDStoreTag());
    tags.push(renderFBPGenerateTag());
  }

  return tags;
}
```

**Click trigger architecture** — no `:contains()` selectors anywhere. Triggers must use the `IRTrigger.trigger_type` to determine GTM trigger structure:

```typescript
function renderGTMTrigger(trigger: IRTrigger, eventName: string): GTMTrigger {
  switch (trigger.trigger_type) {
    case 'page_load':
      return { type: 'PAGEVIEW', name: `PV - All Pages` };

    case 'custom_event':
      return {
        type: 'CUSTOM_EVENT',
        name: `CE - ${eventName}`,
        customEventFilter: [{ type: 'EQUALS', parameter: [
          { key: 'arg0', value: '{{_event}}' },
          { key: 'arg1', value: eventName }
        ]}]
      };

    case 'click_css':
      // Valid CSS3 selector — class, id, attribute, tag
      return {
        type: 'CLICK',
        name: `Click - ${eventName}`,
        filter: [{ type: 'CSS_SELECTOR', parameter: [
          { key: 'arg0', value: '{{Click Element}}' },
          { key: 'arg1', value: trigger.selector }
        ]}],
        waitForTags: true,
        checkValidation: true
      };

    case 'click_text':
      // Replaces :contains() — uses GTM built-in Click Text variable
      return {
        type: 'CLICK',
        name: `Click - ${eventName}`,
        filter: [{ type: 'EQUALS', parameter: [
          { key: 'arg0', value: '{{Click Text}}' },
          { key: 'arg1', value: trigger.click_text }
        ]}],
        waitForTags: true,
        checkValidation: true
      };

    case 'click_url':
      // Uses GTM built-in Click URL variable
      return {
        type: 'CLICK',
        name: `Click - ${eventName}`,
        filter: [{ type: 'CONTAINS', parameter: [
          { key: 'arg0', value: '{{Click URL}}' },
          { key: 'arg1', value: trigger.click_url_pattern }
        ]}],
        waitForTags: true,
        checkValidation: true
      };

    case 'form_submit':
      return {
        type: 'FORM_SUBMISSION',
        name: `Form - ${eventName}`,
        waitForTags: true,
        checkValidation: true,
        filter: trigger.selector ? [{ type: 'CSS_SELECTOR', parameter: [
          { key: 'arg0', value: '{{Form Element}}' },
          { key: 'arg1', value: trigger.selector }
        ]}] : []
      };
  }
}
```

**Note to Claude Code:** The Crawl Signal Extractor (when built) must output `trigger_type: 'click_text'` + `click_text: 'Register Now'` for text-matched elements, not `:contains('Register Now')`. Update the extractor's selector output logic accordingly.

**Consent Mode v2 HTML tags** must use the four standard consent type keys throughout:

```javascript
// In Atlas - Consent Mode v2 Default tag
gtag('consent', 'default', {
  analytics_storage: 'denied',
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  wait_for_update: 500
});

// In Atlas - Consent Mode v2 Update tag
// Read from dataLayer event pushed by the CMP:
gtag('consent', 'update', {
  analytics_storage: event.analytics_storage || 'denied',
  ad_storage: event.ad_storage || 'denied',
  ad_user_data: event.ad_user_data || 'denied',
  ad_personalization: event.ad_personalization || 'denied'
});
```

The dataLayer push event for CMP integration must also use these keys (update the implementation guide template accordingly — see Module D).

#### 6.B.3 Built-in Variables to Enable

The rendered container must enable these GTM built-in variables when needed:

```typescript
const REQUIRED_BUILTINS = {
  click_css_or_url: ['Click Element', 'Click Classes', 'Click ID', 'Click Target',
                     'Click URL', 'Click Text'],
  form_submit: ['Form Element', 'Form Classes', 'Form ID', 'Form Target', 'Form URL', 'Form Text'],
  always: ['Page URL', 'Page Hostname', 'Page Path', 'Referrer', 'Event']
};
```

Enable the appropriate set based on which trigger types are used in the IR.

---

### Module C: GenerationValidator

Runs synchronously after rendering, before delivery. Must pass all rules or return structured errors. Atlas UI must surface these errors if any rule fails — do not silently deliver invalid output.

#### 6.C.1 Validation Rules

**Rule 1 — Variable Resolution**
```
For every string value in any GTM tag parameter that matches the pattern {{...}}:
  Assert that a variable with that exact display name exists in containerVersion.variable[]
  
FAIL: {{CONVERSION_LABEL}} — no matching variable
FAIL: {{GA4_MEASUREMENT_ID}} — no matching variable (correct is {{CONST - GA4 Measurement ID}})
PASS: {{CONST - GA4 Measurement ID}} — variable exists
```

**Rule 2 — Tag Name Uniqueness**
```
For all tags in containerVersion.tag[]:
  Assert no two tags share the same `name` value.

FAIL: Three tags named 'GA4 - People fill out a form here'
```

**Rule 3 — Consent Settings Present**
```
For every tag of type: gaawc, gaawe, awct, gclidw, html (non-Atlas-utility):
  Assert consentSettings.consentStatus !== 'notSet'

FAIL: Any platform tag with consentStatus: 'notSet'
```

**Rule 4 — EventParameters Completeness**
```
For every GA4 event tag (type: gaawe):
  Find the corresponding IREvent by matching eventName
  For each parameter in IREvent.parameters[]:
    Assert that a matching key exists in the tag's eventParameters map

FAIL: GA4 - banner_carousel_navigation has no eventParameters
FAIL: GA4 - logo_click has no eventParameters
```

**Rule 5 — Schema/Snippet Consistency**
```
For each event in machine_spec.pages[*].events[]:
  Extract the set of parameter keys from event.parameters[]
  Parse the code_snippet and extract the set of keys in the dataLayer.push() call
  Assert these two sets are equal

FAIL: enquire_now_click parameters = {cta_text, cta_location, cta_destination, form_id}
      enquire_now_click snippet keys = {form_id, value, currency, user_data}
```

**Rule 6 — Selector Validity**
```
For every trigger in containerVersion.trigger[]:
  For every filter condition value:
    Assert the string does not contain ':contains(', ':has-text(', ':text('
    Assert the string does not contain jQuery-style pseudo-selectors

For every element_selector field in machine_spec:
  Apply same assertion

FAIL: 'a:contains("Register Now")'
FAIL: 'a.rts-theme-btn:contains("Learn More")'
```

**Rule 7 — Business Type Isolation**
```
If ir.business_type === 'lead_gen':
  For every event in ir.events[]:
    Assert action_type not in ['view_item', 'view_item_list', 'add_to_cart', 'purchase']
    Assert no parameter has key in ['item_id', 'item_name', 'price', 'quantity']
    Assert no parameter example value contains '$', '£', '€' (price indicators)
    Assert no code_snippet contains 'ecommerce:' object

FAIL: learn_more_click action_type: 'view_item' on lead_gen site
FAIL: school_level_navigation items example: [{item_name: 'Widget', price: 29.99}]
```

**Rule 8 — Metadata Accuracy**
```
Assert metadata.events_count === ir.events.length
Assert metadata.conversions_count === count of events where is_conversion === true
Assert metadata.platforms === sorted(ir.platforms)
Assert metadata.total_tags === containerVersion.tag.length

FAIL: metadata.conversions_count = 0, actual conversion events = 3
```

**Rule 9 — Placeholder Guide Consistency**
```
Collect all_unresolved_placeholders:
  Scan all CONST variables with empty or placeholder values
  Scan all {{...}} references not resolved to a defined variable
  
Collect guide_placeholders:
  Parse implementation_guide.md Section 3 placeholder table → set of placeholder names

Assert all_unresolved_placeholders ⊆ guide_placeholders
Assert guide_placeholders ⊆ all_unresolved_placeholders

FAIL: CONST - GAds Conversion Label - lead_form_submit not in guide
FAIL: Meta Pixel ID in guide, no Meta Pixel tag in container
```

**Rule 10 — Per-Event Conversion Labels**
```
For every Google Ads conversion tag (type: awct):
  Assert conversionLabel value is of the form {{CONST - GAds Conversion Label - *}}
  Assert a CONST variable with that exact name exists in containerVersion.variable[]

FAIL: conversionLabel: {{CONVERSION_LABEL}} (shared, non-existent variable)
```

#### 6.C.2 Validator Error Format

```typescript
interface ValidationResult {
  passed: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

interface ValidationError {
  rule: string;           // e.g. 'VARIABLE_RESOLUTION'
  severity: 'CRITICAL' | 'HIGH';
  location: string;       // e.g. 'GTM tag: Google Ads - lead_form_submit Conversion'
  message: string;
  fix_hint: string;       // Human-readable fix suggestion
}
```

CRITICAL errors block delivery entirely. HIGH errors surface as warnings the user must acknowledge. No silent failures.

---

### Module D: Implementation Guide Renderer

The implementation guide is fully derived from the IR and the rendered artefacts. No section is hardcoded.

#### 6.D.1 Metadata Block

```typescript
function renderMetadataBlock(ir: AtlasIR, container: GTMContainer): string {
  const events = ir.events.length;
  const conversions = ir.events.filter(e => e.is_conversion).length;
  const platforms = ir.platforms.sort().join(', ');
  const tags = container.containerVersion.tag.length;
  const date = new Date(ir.metadata.generated_at).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric'
  });

  return `**Total events:** ${events} · **Conversions:** ${conversions} · **Platforms:** ${platforms} · **Tags:** ${tags}`;
}
```

#### 6.D.2 Placeholder Table Derivation

```typescript
function derivePlaceholderTable(ir: AtlasIR, container: GTMContainer): PlaceholderRow[] {
  const rows: PlaceholderRow[] = [];

  // Find CONST variables with empty values
  for (const variable of container.containerVersion.variable) {
    if (variable.type === 'c' && (!variable.parameter[0]?.value || variable.parameter[0].value === '')) {
      rows.push({
        placeholder: variable.name,
        where_to_find: getPlaceholderHint(variable.name),
        example: getPlaceholderExample(variable.name)
      });
    }
  }

  return rows;
}

function getPlaceholderHint(variableName: string): string {
  if (variableName.includes('GA4 Measurement ID'))
    return 'GA4 → Admin → Data streams → Measurement ID';
  if (variableName.includes('Google Ads Conversion ID'))
    return 'Google Ads → Goals → Conversions → Conversion ID';
  if (variableName.includes('GAds Conversion Label'))
    return `Google Ads → Goals → Conversions → select "${variableName.split(' - ').pop()}" → Conversion label`;
  if (variableName.includes('Meta Pixel'))
    return 'Meta Events Manager → Pixel ID';
  return 'See your platform account settings';
}
```

#### 6.D.3 CMP Integration Snippet

Replace the current snippet template. Must use the four standard Consent Mode v2 keys:

```javascript
// Fire this from your CMP when the user makes a consent decision.
// Replace 'granted'/'denied' based on the user's choice for each category.
window.dataLayer.push({
  event: 'consent_update',
  analytics_storage: 'granted',     // 'denied' if analytics declined
  ad_storage: 'granted',            // 'denied' if advertising declined
  ad_user_data: 'granted',          // 'denied' if ad personalisation declined
  ad_personalization: 'granted'     // 'denied' if personalisation declined
});
```

#### 6.D.4 Enhanced Conversions Section

Add a new section to the implementation guide (Section 5, before Consent Mode):

```markdown
## 5. Enhanced Conversions Setup

The Google Ads conversion tags are pre-configured for Enhanced Conversions.
To activate, push user contact data alongside conversion events:

```js
window.dataLayer.push({
  event: 'lead_form_submit',        // or any conversion event
  form_id: 'your_form_id',
  // ...other required params...
  user_data: {
    email: 'user@example.com',         // Raw email — hashed automatically
    phone_number: '+6512345678'        // E.164 format — hashed automatically
  }
});
```

GTM hashes email and phone before sending to Google Ads.
Never log or store raw values server-side from the dataLayer.
```

---

## 7. LLM Prompt Changes

The LLM prompt for event generation must be updated to produce IR-compatible output:

### 7.1 Remove from LLM scope
- Raw JSON for GTM tags, triggers, or variables — renderer handles this
- Code snippet generation — renderer handles this
- Metadata counts — derived post-rendering
- Example values for parameters — provide a controlled example library instead

### 7.2 Add to LLM scope
- `trigger.trigger_type` classification (must choose from the enum)
- `trigger.click_text` (extracted text, not a selector)
- `trigger.click_url_pattern` (substring of href)
- `trigger.selector` (valid CSS3 only — validator will reject `:contains()`)
- `is_conversion` boolean per event
- `standard_event_alias` for conversion events on lead_gen sites
- `action_type` chosen from the business-type allowlist

### 7.3 Prompt guardrails to add

Add to system prompt:
```
NEVER use CSS :contains() pseudo-selectors. For elements identified by their visible text,
set trigger_type: 'click_text' and populate click_text with the exact visible text string.

NEVER emit ecommerce object structures (items arrays, item_id, item_name, price fields)
for business_type: lead_gen. These sites have no products.

NEVER mark gclid, fbclid, gbraid, or wbraid as required parameters.
These belong in the attribution block only.

For every event where is_conversion: true on a lead_gen site,
set standard_event_alias: 'generate_lead'.

Parameter examples must be contextually appropriate for the site being analysed.
A school website should never have examples like 'SKU-1', 'Widget', or 'Summer Collection'.
```

---

## 8. Implementation Sequence

Implement in this order. Each step is a testable unit.

### Phase 1 — Schema & Validator (no LLM changes yet)
1. Define `AtlasIR` TypeScript types
2. Build `GenerationValidator` with all 10 rules
3. Write unit tests for each validation rule against the NLCS output (all 10 must fail, confirming the validator catches known issues)
4. Wire validator into the delivery pipeline — block on CRITICAL errors

### Phase 2 — Renderer (deterministic output)
5. Build `renderCodeSnippet()` template function
6. Build `renderGTMTrigger()` with all trigger types
7. Build `renderGA4EventParameters()` covering all events
8. Build `renderConsentSettings()` per platform
9. Build `renderGoogleAdsConversionTag()` with per-event label variables and Enhanced Conversions
10. Build `renderInfrastructureTags()` with platform-conditional logic
11. Build `renderImplementationGuide()` with derived metadata and placeholder table
12. Run validator against renderer output — all 10 rules must pass

### Phase 3 — LLM Prompt Updates
13. Update system prompt with guardrails from Section 7
14. Update output schema to IR format
15. Run generation against NLCS Singapore test case
16. Validate output — all 10 rules must pass
17. Manual QA: verify GTM container imports cleanly, GA4 Config tag loads, conversion labels are all distinct variables

### Phase 4 — Standards Additions
18. Add `standard_event_alias` rendering (second GA4 tag per conversion)
19. Add Enhanced Conversions UI prompt ("Do you collect email/phone at conversion?")
20. Add Consent Mode v2 standard keys throughout

---

## 9. Testing Requirements

### 9.1 Unit Tests

| Test | Input | Expected output |
|---|---|---|
| renderCodeSnippet — params match schema | IREvent with 4 params | Snippet has exactly 4 dataLayer keys |
| renderCodeSnippet — no selector as value | IREvent with selector trigger | form_id placeholder is `{{FORM_ID}}`, not the selector |
| renderGTMTrigger — click_text | trigger_type: click_text | GTM CLICK trigger with Click Text filter, no CSS selector |
| renderGTMTrigger — no :contains | Any trigger | No string `:contains(` in output |
| renderConsentSettings — GA4 | platform: ga4 | consentType includes analytics_storage |
| renderConsentSettings — Google Ads | platform: google_ads | consentType includes ad_storage, ad_user_data, ad_personalization |
| renderGoogleAdsConversionTag | event: lead_form_submit | conversionLabel: `{{CONST - GAds Conversion Label - lead_form_submit}}` |
| renderGoogleAdsConversionTag | any conversion event | enhancedConversionsEnabled: true |
| businessTypeAllowlist — lead_gen | action_type: view_item | Throws validation error |
| businessTypeAllowlist — ecommerce | action_type: view_item | Passes |
| platformConditional — ga4 only | platforms: [ga4] | No Meta tags in output |
| platformConditional — meta | platforms: [ga4, meta] | Meta Pixel base tag present |
| derivePlaceholderTable | container with 3 CONST vars | Guide table has 3 rows |
| derivePlaceholderTable | no Meta Pixel tag | Guide table has no Meta Pixel row |
| Validator Rule 1 | {{CONVERSION_LABEL}} in tag | CRITICAL error: unresolved variable |
| Validator Rule 5 | Snippet keys ≠ schema keys | CRITICAL error: schema/snippet mismatch |
| Validator Rule 7 | ecommerce object on lead_gen | CRITICAL error: business type isolation |

### 9.2 Integration Test: NLCS Re-generation

After Phase 3, regenerate the NLCS Singapore output and assert:

- [ ] `atlas-datalayer_spec.json` — every event's `parameters[]` keys match its `code_snippet` keys
- [ ] `atlas-gtm_container.json` imports into GTM without warnings
- [ ] All 8 GA4 event tags have non-empty `eventParameters`
- [ ] All 3 Google Ads conversion tags have distinct `conversionLabel` variable references
- [ ] All 3 Google Ads conversion tags have `enhancedConversionsEnabled: true`
- [ ] `CONST - GA4 Measurement ID` variable exists and is referenced correctly by GA4 Config tag
- [ ] No tag has `consentStatus: 'notSet'`
- [ ] No trigger contains `:contains(`
- [ ] No two tags share a name
- [ ] No ecommerce object or `items` array in any event
- [ ] `generate_lead` alias tags exist for all 3 conversion events
- [ ] `atlas-implementation_guide.md` placeholder table lists exactly: GA4 Measurement ID, Google Ads Conversion ID, GAds Conversion Label - enquire_now_click, GAds Conversion Label - register_now_click, GAds Conversion Label - lead_form_submit
- [ ] Guide header `Conversions: 3`, not `Conversions: 0`
- [ ] CMP snippet uses `analytics_storage`, not `analytics`

### 9.3 GTM Validation (manual)
Import the regenerated container into a test GTM workspace. Confirm:
- [ ] No import errors
- [ ] GA4 Config tag shows correct Measurement ID field
- [ ] Each conversion event has its own unique Conversion Label field
- [ ] Tag names are all distinct and readable

---

## 10. Files to Create / Modify

```
backend/
  src/
    generation/
      ir.types.ts                    ← NEW: IR type definitions
      renderer/
        spec.renderer.ts             ← NEW: DataLayer spec renderer
        gtm.renderer.ts              ← NEW: GTM container renderer
        guide.renderer.ts            ← NEW: Implementation guide renderer
        trigger.renderer.ts          ← NEW: GTM trigger renderer
        consent.renderer.ts          ← NEW: Consent settings renderer
      validator/
        generation.validator.ts      ← NEW: All 10 validation rules
        validator.types.ts           ← NEW: ValidationResult types
      templates/
        consent-mode-default.html    ← MODIFY: Use standard consent keys
        consent-mode-update.html     ← MODIFY: Use standard consent keys
        click-id-capture.html        ← Keep as-is
        traffic-source-capture.html  ← Keep as-is
      prompts/
        event-extraction.prompt.ts   ← MODIFY: Add guardrails from Section 7
        ir-schema.prompt.ts          ← NEW: IR output schema for LLM
    routes/
      generate.route.ts              ← MODIFY: Add validator to pipeline
  tests/
    generation/
      renderer.test.ts               ← NEW: Unit tests per Section 9.1
      validator.test.ts              ← NEW: Validator rule unit tests
      nlcs.integration.test.ts       ← NEW: NLCS re-generation integration test
```

---

## 11. Success Criteria

This PRD is complete when:

1. `GenerationValidator` catches all 10 rule violations in current NLCS output (regression test baseline)
2. Re-generated NLCS output passes all 10 validation rules
3. NLCS GTM container imports into GTM without warnings
4. All NLCS integration test checkboxes in Section 9.2 pass
5. No new client output can be delivered while any CRITICAL validation error exists

---

*Generated by Atlas audit session · Spi3l LLC*
