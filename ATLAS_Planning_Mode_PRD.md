# ATLAS Planning Mode — Product Requirements Document

## Document Purpose

This PRD defines the Planning Mode feature for Atlas. Planning Mode is a new, separate section of Atlas that sits *before* the existing audit functionality. It helps users plan, define, and generate their entire tracking infrastructure from scratch — using an AI agent to analyse their site, recommend what to tag, generate the dataLayer specification, and produce a ready-to-import GTM container JSON file.

This document is intended to be consumed directly by Claude Code as the implementation specification.

### How Planning Mode Relates to Existing Atlas

```
ATLAS PRODUCT STRUCTURE:

┌─────────────────────────────────────────────────┐
│  PLANNING MODE (this PRD)                       │
│  "What should I track, and build it for me"     │
│                                                 │
│  1. AI agent scans site                         │
│  2. Recommends elements to tag                  │
│  3. User approves/modifies                      │
│  4. Generates dataLayer spec for developers     │
│  5. Generates GTM container JSON for import     │
│  6. Generates WalkerOS flow.json (optional)     │
├─────────────────────────────────────────────────┤
│  ↓ Handoff: tracking is implemented             │
├─────────────────────────────────────────────────┤
│  AUDIT MODE (existing Atlas, previous PRD)      │
│  "Is my tracking working correctly?"            │
│                                                 │
│  1. User defines journey (Journey Builder)      │
│  2. Atlas simulates via Browserbase             │
│  3. Validates signals against expectations      │
│  4. Gap Report: what's missing, what's wrong    │
└─────────────────────────────────────────────────┘
```

Planning Mode outputs become the inputs for Audit Mode. The user plans their tracking → developers implement it → user runs an audit to verify it's working.

---

## 1. Problem Statement

Before a marketer can audit their tracking, they need to *have* tracking. Today, setting up tracking from scratch requires:

1. A marketer who knows what pages and actions matter for their business
2. An analytics specialist who can translate that into a measurement plan
3. A developer who can write the dataLayer code and add it to the site
4. A GTM specialist who can build the tags, triggers, and variables in Google Tag Manager
5. Coordination between all four people (or one person wearing all four hats)

This process typically takes 2–4 weeks, costs $2,000–$10,000 at an agency, and frequently produces incomplete or incorrect implementations.

**Planning Mode compresses this into a guided, AI-assisted workflow that a single non-technical person can complete in 15–20 minutes**, producing developer-ready dataLayer code and a complete GTM container JSON file that can be imported directly.

### Target User

Same as the Journey Builder: non-technical marketing agency PMs and SMB marketers. They know their business goals but cannot write tracking code.

### Key Insight

The AI agent doesn't need to be perfect. It needs to be *good enough* to give the user a strong starting point they can review and modify. An 80% accurate recommendation that the user refines is infinitely better than starting from zero.

---

## 2. Feature Overview

Planning Mode adds five major capabilities:

| Capability | Description |
|-----------|-------------|
| **AI Site Scanner** | Browserbase visits the user's site. Claude API analyses each page's DOM + screenshots to identify interactive elements worth tracking. |
| **Element Recommendation Engine** | AI categorises discovered elements (purchase buttons, forms, CTAs, navigation, search) and recommends which ones to tag, with business justification. |
| **Interactive Review & Approval UI** | User sees AI recommendations with annotated screenshots. They approve, reject, modify, or add elements. |
| **dataLayer Specification Generator** | Produces complete, commented dataLayer.push() code per page, ready for a developer to implement. |
| **GTM Container Generator** | Produces a complete GTM container JSON file (tags + triggers + variables + dataLayer variables) that can be imported directly into GTM. Includes a step-by-step guide explaining every component. |

---

## 3. The AI Agent Architecture

### 3.1 Why an AI Agent (Not a Rule-Based Crawler)

A rule-based crawler can find all `<button>`, `<form>`, and `<a>` elements on a page. But it cannot:

- Distinguish between a "Buy Now" button and a "Back to Top" button
- Understand that a multi-step checkout form is a high-value conversion point
- Recognise that a "Request a Quote" CTA on a B2B site is the primary conversion event
- Identify which elements are *business-critical* vs. which are navigational noise
- Name events in a way that makes sense for the specific business context

An AI agent (Claude via API) can do all of these things. It sees the page the way a human analytics consultant would — understanding context, hierarchy, and business intent.

### 3.2 Agent Components

```
┌──────────────────────────────────────────────────────┐
│  ATLAS PLANNING AGENT                                │
│                                                      │
│  ┌─────────────┐    ┌──────────────┐                │
│  │ Browserbase  │───→│ Page Capture │                │
│  │ (Headless    │    │ Engine       │                │
│  │  Chrome)     │    │              │                │
│  └─────────────┘    └──────┬───────┘                │
│                            │                         │
│              ┌─────────────▼──────────────┐          │
│              │  Captured Data Per Page:    │          │
│              │  • Full-page screenshot     │          │
│              │  • Simplified DOM tree      │          │
│              │  • All interactive elements │          │
│              │  • Form structures          │          │
│              │  • Existing tags detected   │          │
│              └─────────────┬──────────────┘          │
│                            │                         │
│              ┌─────────────▼──────────────┐          │
│              │  Claude API (Analysis)      │          │
│              │                             │          │
│              │  Input: screenshot + DOM    │          │
│              │  Output: structured JSON    │          │
│              │  of recommended elements    │          │
│              │  to tag, with categories,   │          │
│              │  event names, and business  │          │
│              │  justification              │          │
│              └─────────────┬──────────────┘          │
│                            │                         │
│              ┌─────────────▼──────────────┐          │
│              │  Recommendation Engine      │          │
│              │                             │          │
│              │  Merges AI recommendations  │          │
│              │  with Action Primitives     │          │
│              │  from Mapping Engine        │          │
│              │  (from Journey Builder PRD) │          │
│              └────────────────────────────┘          │
└──────────────────────────────────────────────────────┘
```

### 3.3 Page Capture Engine

The Page Capture Engine uses Browserbase to visit each page and extract structured data for the AI to analyse.

```typescript
// File: src/planning/page-capture.ts

export interface PageCapture {
  url: string;
  actual_url: string;                      // After redirects
  page_title: string;
  screenshot_base64: string;               // Full-page screenshot (PNG)
  viewport_screenshot_base64: string;      // Above-the-fold screenshot
  simplified_dom: SimplifiedDOMNode[];     // Cleaned DOM tree (see below)
  interactive_elements: InteractiveElement[];
  forms: FormCapture[];
  existing_tracking: ExistingTrackingDetection;
  meta_tags: Record<string, string>;       // Open Graph, description, etc.
  page_load_time_ms: number;
}

export interface SimplifiedDOMNode {
  tag: string;
  id?: string;
  classes?: string[];
  text_content?: string;                   // Visible text (truncated to 200 chars)
  href?: string;
  type?: string;                           // For inputs
  role?: string;                           // ARIA role
  data_attributes?: Record<string, string>;
  children?: SimplifiedDOMNode[];
  bounding_box?: { x: number; y: number; width: number; height: number };
}

export interface InteractiveElement {
  element_id: string;                      // Generated unique ID for this element
  tag: string;                             // button, a, input[type=submit], etc.
  text: string;                            // Visible text on the element
  selector: string;                        // CSS selector that uniquely identifies this element
  xpath: string;                           // XPath alternative
  element_type: 'button' | 'link' | 'form_submit' | 'input' | 'select' | 'custom';
  parent_form_id?: string;                 // If this element is inside a form
  href?: string;                           // For links
  bounding_box: { x: number; y: number; width: number; height: number };
  is_visible: boolean;
  is_above_fold: boolean;
  screenshot_crop_base64?: string;         // Cropped screenshot of just this element + context
}

export interface FormCapture {
  form_id: string;                         // Generated unique ID
  action: string;                          // Form action URL
  method: string;                          // GET/POST
  selector: string;                        // CSS selector
  fields: FormField[];
  submit_button: InteractiveElement | null;
}

export interface FormField {
  name: string;
  type: string;                            // text, email, tel, number, select, textarea, etc.
  label: string;                           // Associated <label> text
  placeholder?: string;
  required: boolean;
  selector: string;
}

export interface ExistingTrackingDetection {
  gtm_detected: boolean;
  gtm_container_id?: string;
  ga4_detected: boolean;
  ga4_measurement_id?: string;
  meta_pixel_detected: boolean;
  meta_pixel_id?: string;
  google_ads_detected: boolean;
  google_ads_id?: string;
  tiktok_pixel_detected: boolean;
  linkedin_insight_detected: boolean;
  walkeros_detected: boolean;
  other_tags: string[];                    // Other tracking scripts found
  datalayer_events_found: string[];        // Any existing dataLayer.push events
}
```

**DOM Simplification Rules:**

The raw DOM is too large to send to Claude API. The Page Capture Engine must simplify it:

1. Remove all `<script>`, `<style>`, `<noscript>`, `<svg>` (unless SVG is an icon inside a button), and `<head>` contents
2. Remove hidden elements (`display: none`, `visibility: hidden`, `aria-hidden="true"`)
3. Collapse deeply nested `<div>` wrappers that contain no interactive elements
4. Keep all interactive elements: `<button>`, `<a>`, `<input>`, `<select>`, `<textarea>`, `<form>`, elements with `role="button"`, elements with `onclick` handlers
5. Keep structural landmarks: `<header>`, `<nav>`, `<main>`, `<footer>`, `<section>`, `<article>`
6. Truncate text content to 200 characters per element
7. Include bounding box coordinates for all kept elements (needed for annotation)
8. Target output: under 15,000 tokens for the simplified DOM (fits comfortably in Claude's context)

### 3.4 Claude API Analysis — The Core AI Layer

For each page, the Planning Agent sends the screenshot + simplified DOM to Claude API with a structured prompt. Claude returns a JSON recommendation of elements to tag.

```typescript
// File: src/planning/ai-analyzer.ts

export interface AIAnalysisRequest {
  page_url: string;
  page_title: string;
  business_type: string;                   // From Step 1 of wizard (ecommerce, saas, etc.)
  business_context: string;                // User-provided description of their business
  screenshot_base64: string;               // Full-page screenshot
  simplified_dom: SimplifiedDOMNode[];
  interactive_elements: InteractiveElement[];
  forms: FormCapture[];
  existing_tracking: ExistingTrackingDetection;
  platforms_selected: string[];            // Which ad platforms the user selected
}

export interface AIAnalysisResponse {
  page_classification: PageClassification;
  recommended_elements: RecommendedElement[];
  existing_tracking_assessment: TrackingAssessment;
  page_summary: string;                    // 2-3 sentence summary of what this page does
}

export interface PageClassification {
  page_type: string;                       // homepage, product_page, category_page, cart, checkout, etc.
  funnel_position: 'top' | 'middle' | 'bottom' | 'post_conversion';
  business_importance: 'critical' | 'high' | 'medium' | 'low';
  reasoning: string;                       // Why the AI classified it this way
}

export interface RecommendedElement {
  element_reference: string;               // Maps to InteractiveElement.element_id
  selector: string;                        // CSS selector for this element
  recommendation_type: 'track_click' | 'track_form_submit' | 'track_page_view' | 'track_scroll' | 'track_video' | 'track_custom';
  action_primitive_key: string;            // Maps to an Action Primitive (purchase, add_to_cart, etc.) or 'custom'
  suggested_event_name: string;            // e.g., 'add_to_cart', 'submit_contact_form', 'click_cta'
  suggested_event_category: string;        // e.g., 'ecommerce', 'lead_generation', 'engagement'
  business_justification: string;          // Plain English: why this element should be tracked
  priority: 'must_have' | 'should_have' | 'nice_to_have';
  parameters_to_capture: SuggestedParam[];
  confidence: number;                      // 0.0 to 1.0 — how confident the AI is
  screenshot_annotation: {                 // Where to draw the highlight box on the screenshot
    x: number;
    y: number;
    width: number;
    height: number;
    label: string;                         // Short label for the annotation
  };
}

export interface SuggestedParam {
  param_key: string;                       // e.g., 'value', 'item_name', 'form_id'
  param_label: string;                     // e.g., 'Order Total', 'Product Name'
  source: 'element_text' | 'element_attribute' | 'parent_context' | 'page_url' | 'developer_provided';
  source_detail: string;                   // e.g., 'data-price attribute on product card'
  example_value: string;                   // e.g., '29.99'
}

export interface TrackingAssessment {
  has_existing_tracking: boolean;
  quality: 'none' | 'minimal' | 'partial' | 'comprehensive';
  summary: string;                         // e.g., "GA4 is installed but no conversion events are configured"
  conflicts: string[];                     // Potential issues with existing setup
}
```

### 3.5 Claude API Prompt Design

The prompt sent to Claude API for each page analysis must be carefully structured. Here is the system prompt and user prompt template:

```typescript
// File: src/planning/prompts/page-analysis-prompt.ts

export const PAGE_ANALYSIS_SYSTEM_PROMPT = `You are an expert web analytics consultant and conversion tracking specialist. You are analysing a web page to recommend which elements should be tracked for marketing measurement.

Your job is to look at the screenshot and DOM structure and identify:
1. High-value conversion elements (purchase buttons, form submissions, sign-up CTAs)
2. Engagement elements (add-to-cart, wishlist, search, filter interactions)
3. Navigation elements worth tracking (if they indicate funnel progression)

RULES:
- Focus on BUSINESS VALUE. Don't recommend tracking every button — only elements that help measure marketing performance, conversions, or user engagement.
- Prioritise conversion events (purchases, form submissions, sign-ups) as "must_have".
- Prioritise engagement events (add-to-cart, search, product views) as "should_have".
- Classify nice-to-have interactions (social shares, footer links, accordion toggles) as "nice_to_have".
- Map each recommendation to a standard event name where possible (GA4 recommended events: purchase, add_to_cart, begin_checkout, generate_lead, sign_up, search, view_item, select_item, view_item_list, add_to_wishlist, share, login).
- Use custom event names only when no standard event applies. Format: snake_case, descriptive (e.g., click_request_demo, submit_newsletter, download_whitepaper).
- For each recommended element, explain in plain English WHY it should be tracked (the business_justification field).
- Be specific about which parameters can be captured from the page (look at data attributes, surrounding text, URL patterns).
- If existing tracking is detected, note what's already covered and what's missing.

CONFIDENCE SCORING:
- 0.9-1.0: Obviously important (checkout button, purchase form, primary CTA)
- 0.7-0.89: Very likely important (add-to-cart, contact form, sign-up)
- 0.5-0.69: Probably important but depends on business context (filter, sort, secondary CTA)
- Below 0.5: Don't recommend — too uncertain

Respond ONLY with valid JSON matching the AIAnalysisResponse schema. No markdown, no preamble.`;

export function buildPageAnalysisUserPrompt(request: AIAnalysisRequest): object[] {
  return [
    {
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: request.screenshot_base64
      }
    },
    {
      type: "text",
      text: `Analyse this web page for tracking recommendations.

PAGE CONTEXT:
- URL: ${request.page_url}
- Title: ${request.page_title}
- Business type: ${request.business_type}
- Business description: ${request.business_context}
- Ad platforms in use: ${request.platforms_selected.join(', ')}

EXISTING TRACKING DETECTED:
${JSON.stringify(request.existing_tracking, null, 2)}

INTERACTIVE ELEMENTS FOUND ON PAGE:
${JSON.stringify(request.interactive_elements.map(el => ({
  id: el.element_id,
  tag: el.tag,
  text: el.text,
  type: el.element_type,
  selector: el.selector,
  visible: el.is_visible,
  above_fold: el.is_above_fold,
  in_form: el.parent_form_id || null
})), null, 2)}

FORMS FOUND ON PAGE:
${JSON.stringify(request.forms.map(f => ({
  id: f.form_id,
  action: f.action,
  method: f.method,
  fields: f.fields.map(field => ({ name: field.name, type: field.type, label: field.label, required: field.required })),
  submit_button_text: f.submit_button?.text || null
})), null, 2)}

SIMPLIFIED DOM STRUCTURE:
${JSON.stringify(request.simplified_dom).slice(0, 12000)}

Based on the screenshot and the element data above, provide your tracking recommendations as a JSON object matching the AIAnalysisResponse schema.`
    }
  ];
}
```

### 3.6 Agent Orchestration Flow

The Planning Agent orchestrates the full scan across multiple pages:

```typescript
// File: src/planning/agent-orchestrator.ts

export interface PlanningSession {
  id: string;
  user_id: string;
  site_url: string;                        // Root URL of the site
  business_type: string;
  business_context: string;
  platforms: string[];
  status: 'scanning' | 'analysing' | 'ready_for_review' | 'approved' | 'generating';
  pages_to_scan: PageScanConfig[];
  page_captures: PageCapture[];
  ai_recommendations: AIAnalysisResponse[];
  user_decisions: UserDecision[];          // After user reviews
  created_at: string;
}

export interface PageScanConfig {
  url: string;
  label: string;                           // User-provided or auto-detected page name
  scan_status: 'pending' | 'capturing' | 'analysing' | 'complete' | 'failed';
  error?: string;
}
```

**Orchestration sequence:**

```
1. User provides site URL + selects pages to scan (or agent auto-discovers them)
2. For each page:
   a. Browserbase navigates to the page
   b. Page Capture Engine extracts DOM, screenshots, interactive elements, forms, existing tracking
   c. Claude API analyses the capture and returns recommendations
   d. Recommendations are merged with Action Primitives from the Mapping Engine
3. All recommendations are compiled into a unified Tracking Plan
4. User reviews the Tracking Plan (approve/reject/modify per element)
5. Approved plan feeds into the generators (dataLayer spec + GTM container JSON)
```

---

## 4. User Flow — Complete Step-by-Step

### 4.1 Entry Point

**Location:** Main dashboard, alongside the existing "Audit My Tracking" button
**Label:** "Plan My Tracking" or "Set Up Tracking"
**Visual distinction:** Different colour from the audit button (e.g., blue for planning, green for audit) to clearly communicate these are two different workflows.

### 4.2 Step 1 — Site & Business Context

**Screen title:** "Tell us about your site"

**Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| Website URL | Text input | Yes | Root URL of the site (e.g., https://example.com) |
| Business Type | Card selector (same as Journey Builder) | Yes | Ecommerce, SaaS, Lead Gen, Content, Marketplace, Custom |
| What does your business do? | Textarea (3-4 lines) | No but encouraged | Free-text description. Helps the AI understand context. Placeholder: "e.g., We sell handmade furniture online. Our main goal is online purchases, but we also want to track quote requests for custom pieces." |
| Which ad platforms do you use? | Checkboxes | Yes (at least 1) | GA4, Google Ads, Meta, sGTM, TikTok, LinkedIn |

**Button:** "Scan My Site" — proceeds to Step 2.

### 4.3 Step 2 — Page Discovery & Selection

**Screen title:** "Which pages should Atlas analyse?"

**Two approaches (user chooses):**

#### Option A: Auto-Discovery (Recommended for most users)

Atlas uses Browserbase to visit the root URL and follow key navigation links to discover the main pages of the site. The agent:

1. Visits the homepage
2. Identifies the primary navigation menu
3. Follows links to key pages (max 10-15 pages)
4. Classifies each discovered page by type (homepage, product, category, contact, etc.)
5. Presents the discovered pages as a checklist

The user sees:

```
Atlas found these pages on your site:

☑ Homepage                    https://example.com/
☑ Products                    https://example.com/products
☑ Product Detail (sample)     https://example.com/products/oak-dining-table
☑ Cart                        https://example.com/cart
☑ Checkout                    https://example.com/checkout
☑ Contact Us                  https://example.com/contact
☐ About Us                    https://example.com/about
☐ Blog                        https://example.com/blog
☐ FAQ                         https://example.com/faq
☐ Privacy Policy              https://example.com/privacy

[+ Add another page URL]
```

Pages that the AI considers important for tracking are pre-checked. The user can uncheck pages they don't care about and add pages the auto-discovery missed.

#### Option B: Manual Entry

User manually enters URLs, one per line. For users who know exactly which pages they want to analyse, or when auto-discovery fails (auth-gated sites, SPAs with client-side routing).

**Implementation of auto-discovery:**

```typescript
// File: src/planning/page-discovery.ts

export interface DiscoveredPage {
  url: string;
  title: string;
  discovered_from: string;                 // Which page linked to this one
  link_text: string;                       // Text of the link that led here
  is_in_primary_nav: boolean;              // Found in main navigation
  estimated_importance: 'high' | 'medium' | 'low';
  page_type_guess: string;                 // homepage, product, category, etc.
  recommended_for_scan: boolean;           // Pre-checked in the UI
}

/**
 * Auto-discovers pages by:
 * 1. Visit homepage
 * 2. Extract all links from primary nav (<nav>, <header> menus)
 * 3. Follow each link (same domain only)
 * 4. Extract page title and classify page type
 * 5. For ecommerce: also follow one product link from a category page
 * 6. Cap at 15 discovered pages
 * 7. Sort by estimated importance
 */
export async function discoverPages(
  rootUrl: string,
  businessType: string
): Promise<DiscoveredPage[]> {
  // Implementation
}
```

**Button:** "Analyse These Pages" — proceeds to scanning.

### 4.4 Scanning Progress Screen

**Screen title:** "Atlas is scanning your site..."

Shows each page being scanned with real-time status:

```
Scanning your site — this takes 1-2 minutes

✓ Homepage                    Scanned · 12 interactive elements found
✓ Products                    Scanned · 8 interactive elements found
◌ Product Detail              Scanning...
○ Cart                        Waiting
○ Checkout                    Waiting
○ Contact Us                  Waiting

Step 1 of 2: Scanning pages for interactive elements
```

After all pages are scanned, the AI analysis phase begins:

```
✓ All 6 pages scanned

◌ Analysing elements and building recommendations...
  This uses AI to identify which elements matter for your business.

Step 2 of 2: AI analysis
```

Total expected time: 1-3 minutes (depends on number of pages).

### 4.5 Step 3 — Review AI Recommendations (The Core Screen)

**Screen title:** "Here's what Atlas recommends tracking"

This is the most important screen in Planning Mode. The user sees the AI's recommendations and decides what to approve.

#### Layout

**Left panel (60% width):** Annotated screenshot of the current page, with numbered highlight boxes drawn over recommended elements.

**Right panel (40% width):** List of recommendations for this page, each as an expandable card.

**Top navigation:** Page tabs — one tab per scanned page. Click a tab to see that page's screenshot and recommendations.

#### Recommendation Cards

Each recommendation card shows:

```
┌─────────────────────────────────────────────────┐
│ ① [MUST HAVE]  "Add to Cart" Button             │
│                                                  │
│  Event: add_to_cart                              │
│  Why: This button triggers a cart addition.      │
│  Tracking this lets Google Ads and Meta optimise │
│  for high-intent users who add products.         │
│                                                  │
│  Data to capture:                                │
│  • Product name (from page heading)              │
│  • Product price (from price element)            │
│  • Product ID (from URL or data attribute)       │
│  • Currency (SGD — detected from site)           │
│                                                  │
│  [✓ Approve]  [✗ Skip]  [✎ Edit]               │
└─────────────────────────────────────────────────┘
```

The numbered circle (①) corresponds to the annotated highlight on the screenshot.

#### Priority Sections

Recommendations are grouped by priority:

1. **Must Have** (red border) — Conversion events. Skipping these means ad platforms can't see results.
2. **Should Have** (amber border) — Engagement events. Improve optimisation and audience building.
3. **Nice to Have** (grey border) — Additional interactions. Useful for analysis but not critical.

#### User Actions Per Recommendation

| Action | What Happens |
|--------|-------------|
| **Approve** (default for Must Have) | Element is included in the generated tracking plan |
| **Skip** | Element is excluded. Show a brief note if it's a Must Have: "Skipping this means [platform] can't optimise for this conversion." |
| **Edit** | Opens an inline editor where the user can change the event name, modify parameters, or adjust the element selector |

#### Adding Custom Elements

Below the recommendations list, a button: "+ Add an element to track"

This opens a simplified form:
- What element? (text field — describe it: "The newsletter signup form in the footer")
- What happens when someone interacts with it? (dropdown: Clicks a button, Submits a form, Views a section, Custom)
- How important is this? (Must Have / Should Have / Nice to Have)

The AI then attempts to match this description to an element on the page and suggest a selector + event name.

### 4.6 Step 4 — Tracking Plan Summary

**Screen title:** "Your Tracking Plan"

After the user has reviewed all pages, they see a unified summary:

```
YOUR TRACKING PLAN
6 pages · 14 tracked elements · 3 platforms

CONVERSION EVENTS (Must Have)
• Purchase — Order Confirmation page — fires when order completes
• Add to Cart — Product Detail page — fires when "Add to Cart" button clicked
• Submit Contact Form — Contact page — fires when form submitted

ENGAGEMENT EVENTS (Should Have)
• View Item — Product Detail page — fires on page load
• View Item List — Products page — fires on page load
• Begin Checkout — Checkout page — fires on page load
• Search — Homepage — fires when search form submitted

ADDITIONAL EVENTS (Nice to Have)
• Click Phone Number — Contact page
• Click Newsletter Signup — Footer (all pages)
• Download Catalogue — Products page

PLATFORMS
✓ Google Analytics 4 — all events
✓ Google Ads — conversion events only
✓ Meta Pixel — conversion + engagement events

EXISTING TRACKING DETECTED
⚠ GA4 is installed but no conversion events are configured
⚠ Meta Pixel is installed but only tracking PageViews
✗ Google Ads conversion tracking not found

[Generate Tracking Implementation →]
```

**Button:** "Generate Tracking Implementation" — proceeds to output generation.

### 4.7 Step 5 — Generated Outputs

**Screen title:** "Your tracking implementation is ready"

Atlas generates three outputs simultaneously:

#### Output 1: dataLayer Specification (For Developers)

A complete, page-by-page specification of all dataLayer.push() calls that need to be added to the site code.

**Format:** Downloadable document (markdown or HTML) + code snippets that can be copied individually.

**Structure:**

```
DATALAYER SPECIFICATION
Generated by Atlas for: example.com
Date: March 2026

TABLE OF CONTENTS
1. Overview & Setup Instructions
2. Global dataLayer Configuration
3. Page: Homepage
4. Page: Product Detail
5. Page: Cart
6. Page: Checkout
7. Page: Order Confirmation
8. Page: Contact Us
9. Parameter Reference
10. Testing Checklist

────────────────────────────────

1. OVERVIEW & SETUP INSTRUCTIONS

This document contains all the dataLayer code your developer needs
to implement tracking on your site. The code should be added to each
page BEFORE the Google Tag Manager snippet loads.

Steps for your developer:
1. Read this document to understand what needs to be added where
2. Add the Global Configuration (Section 2) to every page
3. Add the page-specific code (Sections 3-8) to each relevant page
4. Test using the Testing Checklist (Section 10)
5. Once implemented, run an Atlas Audit to verify everything works

────────────────────────────────

2. GLOBAL DATALAYER CONFIGURATION

Add this to every page, in the <head>, BEFORE the GTM snippet:

<script>
  window.dataLayer = window.dataLayer || [];
</script>

────────────────────────────────

5. PAGE: ORDER CONFIRMATION

URL pattern: /order-confirmation, /thank-you, /checkout/success
When: After a successful purchase

// PURCHASE EVENT
// Fire this when the order confirmation page loads.
// Replace the placeholder values with your actual order data.
//
// REQUIRED for: Google Analytics 4, Google Ads, Meta Pixel
// Without this: Ad platforms cannot see your sales.

window.dataLayer.push({
  event: 'purchase',
  ecommerce: {
    transaction_id: '{{ORDER_ID}}',         // REQUIRED — Unique order ID from your system
                                              // Example: 'ORD-2024-78901'
                                              // Source: Your order management system

    value: {{ORDER_TOTAL}},                  // REQUIRED — Total order value as a number
                                              // Example: 149.99
                                              // Source: Order total from your checkout

    currency: 'SGD',                         // REQUIRED — ISO currency code
                                              // Detected from your site: SGD

    tax: {{TAX_AMOUNT}},                     // RECOMMENDED — Tax amount
                                              // Example: 10.50

    shipping: {{SHIPPING_COST}},             // RECOMMENDED — Shipping cost
                                              // Example: 5.99

    items: [                                 // RECOMMENDED — Products purchased
      {
        item_id: '{{PRODUCT_SKU}}',          // Product SKU or ID
        item_name: '{{PRODUCT_NAME}}',       // Product name
        price: {{UNIT_PRICE}},               // Unit price
        quantity: {{QUANTITY}}                // Quantity
      }
      // Repeat for each product in the order
    ]
  },

  // ENHANCED CONVERSIONS DATA
  // Needed for Google Ads Enhanced Conversions and Meta CAPI
  // These will be hashed automatically by GTM before sending
  user_data: {
    email: '{{CUSTOMER_EMAIL}}',             // Customer email address
    phone_number: '{{CUSTOMER_PHONE}}'       // Customer phone (with country code)
  }
});

// ── WHY THIS MATTERS ──────────────────────────────
// The purchase event is the most critical tracking event.
// Google Ads uses it for Smart Bidding (Target ROAS, Maximize Conversion Value).
// Meta uses it for purchase optimisation campaigns.
// GA4 uses it for revenue reporting and conversion paths.
// Without transaction_id, conversions will be double-counted.
// ──────────────────────────────────────────────────
```

Each page section follows this same pattern: commented code with inline explanations, placeholder values clearly marked, source hints for the developer, and a "why this matters" section.

#### Output 2: GTM Container JSON

A complete Google Tag Manager container file that can be imported directly.

```typescript
// File: src/planning/generators/gtm-container.ts

export interface GTMContainerExport {
  exportFormatVersion: 2;
  exportTime: string;
  containerVersion: {
    tag: GTMTag[];
    trigger: GTMTrigger[];
    variable: GTMVariable[];
    folder: GTMFolder[];
  };
  implementation_guide: ImplementationGuide; // Separate JSON — the step-by-step guide
}

export interface GTMTag {
  accountId: string;
  containerId: string;
  tagId: string;
  name: string;                            // Human-readable name (e.g., "GA4 - Purchase Event")
  type: string;                            // Tag type (gaawe, html, floodlight, etc.)
  parameter: GTMParameter[];
  firingTriggerId: string[];
  tagFiringOption: string;
  monitoringMetadata: object;
  consentSettings: object;
  notes: string;                           // Explanation of what this tag does
}

export interface GTMTrigger {
  accountId: string;
  containerId: string;
  triggerId: string;
  name: string;                            // e.g., "CE - dataLayer - purchase"
  type: string;                            // customEvent, pageview, click, formSubmission, etc.
  customEventFilter: GTMCondition[];
  filter?: GTMCondition[];
  notes: string;
}

export interface GTMVariable {
  accountId: string;
  containerId: string;
  variableId: string;
  name: string;                            // e.g., "DLV - ecommerce.transaction_id"
  type: string;                            // v (dataLayer variable), jsm (custom JS), etc.
  parameter: GTMParameter[];
  notes: string;
}

export interface GTMFolder {
  accountId: string;
  containerId: string;
  folderId: string;
  name: string;                            // e.g., "Atlas Generated — Purchase Tracking"
}

export interface ImplementationGuide {
  overview: string;
  import_instructions: ImportStep[];
  tags_explained: TagExplanation[];
  triggers_explained: TriggerExplanation[];
  variables_explained: VariableExplanation[];
  testing_instructions: string[];
  troubleshooting: TroubleshootingItem[];
}

export interface ImportStep {
  step_number: number;
  title: string;
  description: string;
  screenshot_description?: string;         // Description of what the user should see
  warning?: string;                        // e.g., "This will not overwrite existing tags"
}

export interface TagExplanation {
  tag_name: string;
  what_it_does: string;
  when_it_fires: string;
  which_platform: string;
  data_it_sends: string[];
  why_it_matters: string;
}
```

**GTM Container Structure:**

For each tracked element, the generator creates:

1. **A dataLayer Variable** for each parameter (e.g., `DLV - ecommerce.transaction_id`, `DLV - ecommerce.value`)
2. **A Custom Event Trigger** that fires on the corresponding dataLayer event (e.g., trigger on `event = 'purchase'`)
3. **A Tag per platform** that sends the data (e.g., GA4 Event Tag for purchase, Google Ads Conversion Tag, Meta Pixel Custom Event)
4. **A Folder** to organize all generated components (e.g., "Atlas — Ecommerce Tracking")

The container JSON follows GTM's official export format so it can be imported via: GTM Admin → Import Container → Choose file → Merge (recommended) or Overwrite.

**Naming conventions for GTM components:**

| Component | Naming Pattern | Example |
|-----------|---------------|---------|
| Tags | `[Platform] - [Event Name]` | `GA4 - Purchase Event` |
| Triggers | `CE - dataLayer - [event_name]` | `CE - dataLayer - purchase` |
| dataLayer Variables | `DLV - [path]` | `DLV - ecommerce.transaction_id` |
| Custom JS Variables | `CJS - [description]` | `CJS - SHA256 Hash Email` |
| Folders | `Atlas — [Category]` | `Atlas — Ecommerce Tracking` |

#### Output 3: WalkerOS Flow Configuration (Optional)

If the user selected WalkerOS in their platform preferences, also generate a complete flow.json file. This reuses the WalkerOS Output Generator from the Journey Builder PRD (Section 4.3.2 of that document). No additional specification needed here — the input is the same approved tracking plan, the output format is the same flow.json.

#### Output 4: Implementation Guide (HTML/PDF)

A step-by-step guide that explains everything that was generated. This is the "for humans" companion to the technical outputs.

**Structure:**

```
ATLAS TRACKING IMPLEMENTATION GUIDE
Generated for: example.com
Date: March 2026

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PART 1: WHAT WAS CREATED

Atlas generated a complete tracking setup for your site:
• 8 Tags (GA4, Google Ads, Meta events)
• 6 Triggers (when to fire each tag)
• 12 Variables (what data to capture)
• 1 GTM Container file (import directly)
• 1 dataLayer specification (for your developer)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PART 2: STEP-BY-STEP SETUP

Step 1: Send the dataLayer Spec to Your Developer
   Your developer needs to add dataLayer code to your site.
   Send them the file: datalayer-specification.md
   They will add code snippets to 6 pages on your site.
   Estimated time: 2-4 hours for an experienced developer.

Step 2: Import the GTM Container
   1. Open Google Tag Manager (tagmanager.google.com)
   2. Select your container
   3. Go to Admin (gear icon) → Import Container
   4. Upload the file: atlas-gtm-container.json
   5. Choose "Merge" → "Rename conflicting tags"
   6. Click "Confirm"

   ⚠️ WARNING: Always import into a new Workspace first.
   Review the changes before publishing.

Step 3: Review What Was Imported
   After importing, you'll see new tags in your container:

   📋 TAG: GA4 - Purchase Event
   What it does: Sends purchase data to Google Analytics 4
   When it fires: When a purchase is completed (dataLayer event: purchase)
   Data it sends: Order ID, order total, currency, product details
   Why it matters: This is how GA4 sees your revenue

   📋 TAG: Google Ads - Purchase Conversion
   What it does: Reports conversions to Google Ads
   When it fires: When a purchase is completed
   Data it sends: Order ID, order total, currency
   Why it matters: Google Ads Smart Bidding uses this to optimise your campaigns

   [... continued for each tag ...]

Step 4: Configure Your Platform IDs
   Some tags need your specific platform IDs.
   Open each tag in GTM and replace the placeholder values:

   • GA4 Measurement ID: Replace "G-XXXXXXXXX" with your actual ID
     (Find it in GA4 → Admin → Data Streams → your stream)
   • Google Ads Conversion ID: Replace "AW-XXXXXXXXX/YYYYYYY"
     (Find it in Google Ads → Tools → Conversions → your conversion)
   • Meta Pixel ID: Replace "1234567890" with your actual Pixel ID
     (Find it in Meta Events Manager → your pixel)

Step 5: Test Everything
   1. In GTM, click "Preview" to enter debug mode
   2. Navigate through your site: homepage → product → add to cart → checkout → purchase
   3. Verify each tag fires at the right time
   4. Check that data values are populated (not showing placeholder values)
   5. Once verified, go back to GTM and click "Submit" to publish

Step 6: Verify with Atlas Audit
   After your developer has implemented the dataLayer code
   and you've published the GTM container:
   1. Go to Atlas → Audit Mode
   2. Your tracking plan is automatically loaded as a journey
   3. Click "Run Audit" to verify everything is working
   4. Atlas will tell you if anything is still missing or broken

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PART 3: TROUBLESHOOTING

Common Issue: Tags are firing but data values are empty
→ The dataLayer code hasn't been implemented yet, or placeholder
  values haven't been replaced. Send the dataLayer spec to your developer.

Common Issue: GTM import shows conflicts
→ Choose "Rename conflicting" during import. Atlas-generated
  components will be prefixed with "Atlas -" to avoid confusion.

Common Issue: Purchase tag fires on every page
→ Check the trigger. It should only fire on "Custom Event = purchase",
  not on "All Pages". If wrong, the import may have failed — try again.
```

### 4.8 Output Download Screen

**Screen title:** "Download Your Implementation"

Four download cards:

| Download | File | Description |
|----------|------|-------------|
| 📄 dataLayer Specification | `atlas-datalayer-spec.md` | Send this to your developer. Contains all the code they need to add to your site. |
| 📦 GTM Container | `atlas-gtm-container.json` | Import this directly into Google Tag Manager. Contains all tags, triggers, and variables. |
| 📖 Implementation Guide | `atlas-implementation-guide.pdf` | Step-by-step instructions for setting everything up. Share with your team. |
| 🔄 WalkerOS Config | `atlas-walkeros-flow.json` | (Only shown if WalkerOS selected) WalkerOS flow configuration file. |
| 📥 Download All | `atlas-tracking-setup.zip` | Everything in one ZIP file. |

Below the downloads:

```
NEXT STEP: After your developer implements the dataLayer code and
you've imported the GTM container, come back to Atlas and run
an Audit to verify everything is working correctly.

[→ Run an Audit Now]   [→ Save & Come Back Later]
```

The "Run an Audit Now" button pre-loads the tracking plan as a Journey in Audit Mode, so the user doesn't have to re-enter anything.

---

## 5. Database Schema (Supabase)

### 5.1 New Tables for Planning Mode

```sql
-- ============================================================
-- PLANNING MODE TABLES
-- ============================================================

-- Planning sessions
CREATE TABLE planning_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  site_url TEXT NOT NULL,
  business_type TEXT NOT NULL,
  business_context TEXT,
  platforms TEXT[] NOT NULL DEFAULT '{}',
  implementation_format TEXT NOT NULL DEFAULT 'gtm' CHECK (implementation_format IN ('gtm', 'walkeros', 'both')),
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN (
    'created', 'discovering', 'scanning', 'analysing', 'ready_for_review',
    'approved', 'generating', 'complete', 'failed'
  )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pages discovered/selected for scanning
CREATE TABLE planning_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES planning_sessions(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  label TEXT NOT NULL,
  page_type TEXT,                            -- Classified by AI or auto-discovery
  scan_status TEXT NOT NULL DEFAULT 'pending' CHECK (scan_status IN (
    'pending', 'capturing', 'analysing', 'complete', 'failed', 'skipped'
  )),
  is_selected BOOLEAN NOT NULL DEFAULT true, -- User can deselect pages
  page_capture JSONB,                        -- Full PageCapture object
  ai_analysis JSONB,                         -- Full AIAnalysisResponse object
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Individual element recommendations (one per recommended element)
CREATE TABLE planning_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES planning_sessions(id) ON DELETE CASCADE,
  page_id UUID NOT NULL REFERENCES planning_pages(id) ON DELETE CASCADE,
  element_reference TEXT NOT NULL,           -- Maps to InteractiveElement.element_id
  selector TEXT NOT NULL,                    -- CSS selector
  recommendation_type TEXT NOT NULL,         -- track_click, track_form_submit, etc.
  action_primitive_key TEXT,                 -- Maps to action primitive (nullable for custom events)
  suggested_event_name TEXT NOT NULL,
  suggested_event_category TEXT NOT NULL,
  business_justification TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('must_have', 'should_have', 'nice_to_have')),
  parameters JSONB NOT NULL DEFAULT '[]',    -- Array of SuggestedParam objects
  confidence DECIMAL(3,2) NOT NULL,
  annotation JSONB,                          -- Screenshot annotation coordinates

  -- User decision
  user_decision TEXT NOT NULL DEFAULT 'pending' CHECK (user_decision IN (
    'pending', 'approved', 'skipped', 'modified'
  )),
  user_modifications JSONB,                  -- If modified: what the user changed
  decided_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Generated outputs
CREATE TABLE planning_outputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES planning_sessions(id) ON DELETE CASCADE,
  output_type TEXT NOT NULL CHECK (output_type IN (
    'datalayer_spec', 'gtm_container', 'walkeros_flow', 'implementation_guide'
  )),
  output_data JSONB,                         -- Structured output data
  file_path TEXT,                            -- Path to generated file in storage
  version INTEGER NOT NULL DEFAULT 1,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_planning_sessions_user_id ON planning_sessions(user_id);
CREATE INDEX idx_planning_sessions_status ON planning_sessions(status);
CREATE INDEX idx_planning_pages_session_id ON planning_pages(session_id);
CREATE INDEX idx_planning_recommendations_session_id ON planning_recommendations(session_id);
CREATE INDEX idx_planning_recommendations_page_id ON planning_recommendations(page_id);
CREATE INDEX idx_planning_recommendations_decision ON planning_recommendations(user_decision);
CREATE INDEX idx_planning_outputs_session_id ON planning_outputs(session_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE planning_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning_outputs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own their planning sessions" ON planning_sessions
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users access own planning pages" ON planning_pages
  FOR ALL USING (session_id IN (SELECT id FROM planning_sessions WHERE user_id = auth.uid()));

CREATE POLICY "Users access own recommendations" ON planning_recommendations
  FOR ALL USING (session_id IN (SELECT id FROM planning_sessions WHERE user_id = auth.uid()));

CREATE POLICY "Users access own outputs" ON planning_outputs
  FOR ALL USING (session_id IN (SELECT id FROM planning_sessions WHERE user_id = auth.uid()));
```

---

## 6. API Endpoints

### 6.1 Planning Session CRUD

```
POST   /api/planning/sessions                  Create new planning session
GET    /api/planning/sessions                  List user's planning sessions
GET    /api/planning/sessions/:id              Get session with pages and recommendations
DELETE /api/planning/sessions/:id              Delete session and all related data
```

### 6.2 Page Discovery & Scanning

```
POST   /api/planning/sessions/:id/discover     Auto-discover pages (Browserbase crawl)
POST   /api/planning/sessions/:id/pages        Manually add pages to scan
PUT    /api/planning/sessions/:id/pages/:pageId  Update page (toggle selection, change label)
DELETE /api/planning/sessions/:id/pages/:pageId  Remove page
POST   /api/planning/sessions/:id/scan         Start scanning all selected pages
GET    /api/planning/sessions/:id/scan/status   Get scan progress (polling endpoint)
```

### 6.3 AI Analysis

```
POST   /api/planning/sessions/:id/analyse      Trigger AI analysis on all captured pages
GET    /api/planning/sessions/:id/recommendations  Get all recommendations grouped by page
```

### 6.4 User Decisions

```
PUT    /api/planning/recommendations/:id/decide  Set decision (approve/skip/modify)
POST   /api/planning/sessions/:id/bulk-decide    Bulk approve/skip (for "Approve All Must-Have" etc.)
POST   /api/planning/sessions/:id/add-custom     Add a custom element recommendation
```

### 6.5 Output Generation

```
POST   /api/planning/sessions/:id/generate     Generate all outputs (dataLayer, GTM, guide)
GET    /api/planning/sessions/:id/outputs       List generated outputs
GET    /api/planning/sessions/:id/outputs/:type  Get specific output (datalayer_spec, gtm_container, etc.)
GET    /api/planning/sessions/:id/download       Download ZIP of all outputs
```

### 6.6 Handoff to Audit Mode

```
POST   /api/planning/sessions/:id/create-journey  Create a Journey (in Audit Mode) from the approved planning session
```

---

## 7. GTM Container Generator — Detailed Specification

This is the most complex generator. It must produce a valid GTM container JSON that imports cleanly.

### 7.1 GTM Export Format

GTM uses a specific JSON format for container exports. The generator must produce this exact format.

```typescript
// File: src/planning/generators/gtm-container-generator.ts

export interface GTMContainerJSON {
  exportFormatVersion: 2;
  exportTime: string;                        // ISO timestamp
  containerVersion: {
    path: string;                            // e.g., "accounts/0/containers/0/versions/0"
    accountId: string;                       // "0" for import
    containerId: string;                     // "0" for import
    containerVersionId: string;              // "0" for import
    name: string;                            // "Atlas Generated Tracking"
    description: string;
    container: {
      path: string;
      accountId: string;
      containerId: string;
      name: string;
      publicId: string;
      usageContext: string[];                // ["WEB"]
      fingerprint: string;
      tagManagerUrl: string;
    };
    tag: GTMTagDef[];
    trigger: GTMTriggerDef[];
    variable: GTMVariableDef[];
    folder: GTMFolderDef[];
    builtInVariable: GTMBuiltInVariable[];
    fingerprint: string;
    tagManagerUrl: string;
  };
}
```

### 7.2 What Gets Generated Per Tracked Event

For each approved recommendation with an action_primitive_key, generate:

**Triggers:**

| Trigger Type | Naming | Fires When |
|-------------|--------|------------|
| Custom Event trigger | `CE - dataLayer - [event_name]` | `event` equals the dataLayer event name (e.g., `purchase`, `add_to_cart`) |
| DOM Ready trigger (for page views) | `DOM Ready - [page type]` | DOM Ready + Page Path matches the stage URL pattern |

**Variables (dataLayer Variables):**

For each parameter in the event, create a DLV:

| Variable | Type | dataLayer Path |
|----------|------|---------------|
| `DLV - ecommerce.transaction_id` | dataLayer Variable (v) | `ecommerce.transaction_id` |
| `DLV - ecommerce.value` | dataLayer Variable (v) | `ecommerce.value` |
| `DLV - ecommerce.currency` | dataLayer Variable (v) | `ecommerce.currency` |
| `DLV - ecommerce.items` | dataLayer Variable (v) | `ecommerce.items` |
| `DLV - user_data.email` | dataLayer Variable (v) | `user_data.email` |
| `DLV - user_data.phone_number` | dataLayer Variable (v) | `user_data.phone_number` |

Also generate utility variables:

| Variable | Type | Purpose |
|----------|------|---------|
| `CJS - SHA256 Hash` | Custom JavaScript | Hashes email/phone for Enhanced Conversions |
| `DLV - event` | dataLayer Variable | Reads the `event` key from dataLayer |

**Tags per platform:**

For **GA4**:
| Tag | Type | Configuration |
|-----|------|--------------|
| `GA4 - Config` | Google Analytics: GA4 Configuration (`gaawc`) | Measurement ID, sends page_view on all pages |
| `GA4 - [Event Name]` | Google Analytics: GA4 Event (`gaawe`) | Event name, parameters mapped from DLVs |

For **Google Ads**:
| Tag | Type | Configuration |
|-----|------|--------------|
| `Google Ads - Conversion Linker` | Conversion Linker | Fires on all pages, captures gclid |
| `Google Ads - [Event Name] Conversion` | Google Ads Conversion Tracking | Conversion ID/Label, value, transaction_id |
| `Google Ads - Remarketing` | Google Ads Remarketing | Dynamic remarketing parameters (optional) |

For **Meta**:
| Tag | Type | Configuration |
|-----|------|--------------|
| `Meta - Base Pixel` | Custom HTML | `fbq('init', '{{PIXEL_ID}}'); fbq('track', 'PageView');` |
| `Meta - [Event Name]` | Custom HTML | `fbq('track', '[MetaEventName]', {parameters})` |

For **TikTok**:
| Tag | Type | Configuration |
|-----|------|--------------|
| `TikTok - Base Pixel` | Custom HTML | TikTok pixel init code |
| `TikTok - [Event Name]` | Custom HTML | `ttq.track('[TikTokEventName]', {parameters})` |

For **LinkedIn**:
| Tag | Type | Configuration |
|-----|------|--------------|
| `LinkedIn - Insight Tag` | Custom HTML | LinkedIn Insight Tag code |
| `LinkedIn - [Event Name]` | Custom HTML | `lintrk('track', {conversion_id: '...'})` |

**Folders:**

| Folder | Contains |
|--------|----------|
| `Atlas — Configuration` | Config tags (GA4 Config, Conversion Linker, Base Pixels) |
| `Atlas — Conversion Events` | Conversion event tags (purchase, generate_lead, sign_up) |
| `Atlas — Engagement Events` | Engagement event tags (add_to_cart, view_item, search, etc.) |
| `Atlas — Variables` | All dataLayer variables and custom JS variables |
| `Atlas — Triggers` | All triggers |

### 7.3 Consent Mode Support

All generated tags should include Google Consent Mode v2 settings:

```json
{
  "consentSettings": {
    "consentStatus": "notSet",
    "consentType": {
      "ad_storage": "needed",
      "analytics_storage": "needed",
      "ad_user_data": "needed",
      "ad_personalization": "needed"
    }
  }
}
```

This ensures tags respect the user's consent management platform. Include a note in the implementation guide explaining that the user may need to configure their CMP to work with GTM Consent Mode.

---

## 8. Frontend Components (React)

### 8.1 Component Hierarchy

```
<PlanningMode>                                // Feature container
  <PlanningWizard>                            // Multi-step flow
    <Step1SiteContext />                       // URL + business type + platforms
    <Step2PageDiscovery>                       // Auto-discover or manual entry
      <DiscoveredPageList />
      <PageCheckbox />
      <ManualUrlEntry />
    </Step2PageDiscovery>
    <ScanningProgress />                      // Real-time scan + analysis progress
    <Step3ReviewRecommendations>              // Core review screen
      <PageTabBar />                          // Tabs for each scanned page
      <AnnotatedScreenshot />                 // Left panel: screenshot with highlight boxes
      <RecommendationList>                    // Right panel: recommendation cards
        <RecommendationCard />                // Individual recommendation
        <CustomElementForm />                 // Add custom element
      </RecommendationList>
    </Step3ReviewRecommendations>
    <Step4TrackingPlanSummary />              // Unified summary before generation
  </PlanningWizard>

  <OutputScreen>                              // Generated outputs
    <OutputCard />                            // Download card per output type
    <ImplementationGuideViewer />             // In-browser guide reader
    <HandoffToAudit />                        // "Run an Audit" CTA
  </OutputScreen>

  <PlanningDashboard>                         // List of saved planning sessions
    <PlanningSessionCard />
  </PlanningDashboard>
</PlanningMode>
```

### 8.2 Annotated Screenshot Component

The annotated screenshot is the key visual component. It must:

1. Display the full-page screenshot with scroll capability
2. Overlay numbered highlight boxes at the coordinates provided by the AI analysis
3. Colour-code boxes by priority (red = must have, amber = should have, grey = nice to have)
4. Show the number label (①, ②, ③) matching the recommendation list
5. On hover: show a tooltip with the element text and suggested event name
6. On click: scroll the right panel to the corresponding recommendation card
7. When a recommendation is approved/skipped, update the box colour (green = approved, faded = skipped)

```typescript
// File: src/components/planning/AnnotatedScreenshot.tsx

interface AnnotatedScreenshotProps {
  screenshotBase64: string;
  annotations: Annotation[];
  onAnnotationClick: (elementId: string) => void;
}

interface Annotation {
  element_id: string;
  number: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  priority: 'must_have' | 'should_have' | 'nice_to_have';
  decision: 'pending' | 'approved' | 'skipped' | 'modified';
}
```

Implementation approach: Render the screenshot as a `<canvas>` or `<img>` with absolute-positioned `<div>` overlays for each annotation. Use CSS transforms for zoom/scroll.

---

## 9. AI Cost Estimation

The Claude API calls are the main variable cost in Planning Mode.

| Operation | Input Tokens (est.) | Output Tokens (est.) | Calls Per Session | Cost Per Session (Sonnet) |
|-----------|--------------------|--------------------|-------------------|--------------------------|
| Page analysis (screenshot + DOM) | ~8,000 (image) + ~4,000 (DOM/elements) | ~2,000 (recommendations JSON) | 6 pages avg | ~$0.12 |
| Page discovery (homepage crawl) | ~3,000 | ~1,000 | 1 | ~$0.01 |
| **Total per planning session** | | | | **~$0.13** |

At the Pro tier ($149/month), if a user runs 20 planning sessions per month, the AI cost is ~$2.60/month per user. This is well within margin.

---

## 10. Implementation Sequence

### Sprint 1 — Page Capture + AI Analysis (Week 1–2)

| Task | Priority | Estimate |
|------|----------|----------|
| Build Page Capture Engine (Browserbase → structured PageCapture) | P0 | 8 hours |
| Build DOM simplification logic | P0 | 6 hours |
| Build interactive element extraction | P0 | 4 hours |
| Build form capture logic | P0 | 3 hours |
| Build existing tracking detection | P0 | 4 hours |
| Build Claude API integration for page analysis | P0 | 6 hours |
| Write and test the page analysis prompt | P0 | 6 hours |
| Build agent orchestrator (multi-page scan + analysis) | P0 | 6 hours |
| Supabase tables + RLS for planning mode | P0 | 3 hours |
| Unit tests: capture + analysis pipeline | P0 | 6 hours |

### Sprint 2 — Review UI + Page Discovery (Week 3–4)

| Task | Priority | Estimate |
|------|----------|----------|
| Build Step 1 (site context form) | P0 | 3 hours |
| Build page auto-discovery via Browserbase | P1 | 8 hours |
| Build Step 2 (page selection with checkboxes) | P0 | 4 hours |
| Build scanning progress screen | P0 | 4 hours |
| Build AnnotatedScreenshot component | P0 | 10 hours |
| Build RecommendationCard component | P0 | 6 hours |
| Build Step 3 (review screen with page tabs) | P0 | 8 hours |
| Build approval/skip/modify actions on recommendations | P0 | 4 hours |
| Build custom element addition form | P1 | 3 hours |
| Build Step 4 (tracking plan summary) | P0 | 4 hours |
| API endpoints for planning session flow | P0 | 6 hours |

### Sprint 3 — GTM Container Generator + dataLayer Spec (Week 5–6)

| Task | Priority | Estimate |
|------|----------|----------|
| Build GTM container JSON generator | P0 | 12 hours |
| Generate tags for GA4 events | P0 | 4 hours |
| Generate tags for Google Ads conversions | P0 | 4 hours |
| Generate tags for Meta Pixel events | P0 | 4 hours |
| Generate tags for TikTok Pixel | P1 | 3 hours |
| Generate tags for LinkedIn Insight | P1 | 3 hours |
| Generate all triggers (Custom Event + DOM Ready) | P0 | 4 hours |
| Generate all dataLayer variables | P0 | 3 hours |
| Generate utility variables (hash functions, consent) | P0 | 3 hours |
| Generate folder structure | P0 | 1 hour |
| Validate generated JSON against GTM import spec | P0 | 4 hours |
| Build dataLayer specification document generator | P0 | 8 hours |
| Build WalkerOS flow.json output (reuse from Journey Builder) | P1 | 4 hours |

### Sprint 4 — Implementation Guide + Output Screen + Polish (Week 7–8)

| Task | Priority | Estimate |
|------|----------|----------|
| Build implementation guide generator (HTML/PDF) | P0 | 8 hours |
| Build tag explanation sections | P0 | 4 hours |
| Build import instructions section | P0 | 3 hours |
| Build testing checklist section | P0 | 2 hours |
| Build troubleshooting section | P1 | 2 hours |
| Build output download screen | P0 | 4 hours |
| Build ZIP bundling (all outputs) | P0 | 2 hours |
| Build handoff to Audit Mode (create journey from planning session) | P0 | 4 hours |
| Build planning dashboard (list saved sessions) | P1 | 4 hours |
| End-to-end testing: full flow from URL entry to GTM import | P0 | 8 hours |
| Test GTM container import in real GTM account | P0 | 4 hours |
| Polish: loading states, error handling, edge cases | P0 | 8 hours |
| Consent Mode v2 support in generated tags | P1 | 3 hours |

---

## 11. Edge Cases & Error Handling

| Scenario | Handling |
|----------|----------|
| Site requires authentication | Detect login walls. Show message: "This site requires login. Atlas cannot currently scan authenticated pages. Please provide URLs to public pages, or contact us for enterprise scanning with authentication support." |
| Site blocks headless browsers | Detect Cloudflare/bot protection. Show: "Your site's security blocked our scanner. This is common with Cloudflare or similar services. Try adding our IP to your allowlist, or manually enter the pages you want to plan." Fall back to manual page entry. |
| SPA with client-side routing | Browserbase should wait for route changes to complete (wait for network idle after hash/pushState changes). If pages don't load properly, flag them in the discovery step. |
| AI returns no recommendations for a page | Show: "Atlas didn't find any trackable elements on this page. This might be a content-only page. You can add custom elements to track if needed." |
| AI confidence is very low on all recommendations | Show recommendations with a notice: "Atlas is less certain about these recommendations. Your site has an unusual structure. Please review each one carefully." |
| Very large site (50+ pages discovered) | Cap auto-discovery at 15 pages. Show: "Atlas found 52 pages. We've selected the 15 most important. You can swap pages in and out before scanning." |
| User approves zero recommendations | Block generation. Show: "You haven't approved any elements to track. Approve at least one element to generate a tracking plan." |
| GTM container import fails | Include troubleshooting in the guide. Common causes: malformed JSON (should not happen if generator is correct), conflicting container IDs. Provide manual setup instructions as fallback. |
| Existing tracking conflicts | If GA4/Meta/etc. are already installed, the generated GTM container should NOT include duplicate base tags. Detection in the Page Capture step should inform the generator to skip base pixel/config tags and only generate event tags. |
| Page takes too long to load | Timeout after 30 seconds per page. Mark as failed: "This page didn't load in time. Skip it or try again." |

---

## 12. Relationship Between Planning Mode and Audit Mode

Planning Mode and Audit Mode share several components:

| Component | Planning Mode Uses It For | Audit Mode Uses It For |
|-----------|--------------------------|----------------------|
| Browserbase | Page capture + DOM extraction | Journey simulation + signal capture |
| Action Primitives | Mapping AI recommendations to standard events | Mapping journey stages to expected events |
| Platform Schemas | Detecting existing tracking + generating platform-specific tags | Validating signals reach platforms correctly |
| Mapping Engine | Generating dataLayer code + WalkerOS config | Generating validation specs |
| Supabase | Storing planning sessions + recommendations | Storing journeys + audit results |

**Handoff flow:**

When a user finishes Planning Mode and clicks "Run an Audit," Atlas:

1. Creates a new Journey (Audit Mode) from the planning session
2. Maps each scanned page to a journey stage
3. Maps each approved recommendation to action toggles on the corresponding stage
4. Maps selected platforms to the journey's platform configuration
5. Pre-fills all URLs from the planning session
6. Opens the Journey in Audit Mode, pre-populated and ready to run

This means the user never re-enters information. Planning flows seamlessly into auditing.

---

## 13. Success Metrics

| Metric | Target | How Measured |
|--------|--------|-------------|
| Planning session completion rate | >50% of users who start finish to output generation | Funnel analytics |
| AI recommendation approval rate | >60% of "must have" recommendations approved without modification | Approval tracking |
| GTM container import success rate | >95% of generated containers import without errors | User feedback + support tickets |
| Time to complete planning session | <20 minutes median | Timestamp tracking |
| Handoff to Audit rate | >40% of completed planning sessions lead to an audit | Session → Journey conversion |
| Developer implementation rate | >30% of generated dataLayer specs are implemented (measured by subsequent audit pass rate) | Audit results on planned sites |

---

## 14. Out of Scope (for this version)

- **Chrome extension / visual picker** — Click-on-page element selection (deferred, too complex for MVP)
- **Authenticated page scanning** — Login-required pages (enterprise feature)
- **Automatic dataLayer deployment** — Injecting code into the user's site (too risky, developers should review)
- **GTM API integration** — Importing the container programmatically via GTM API instead of file download (requires OAuth + complex permissions)
- **Real-time collaboration** — Multiple users editing the same planning session
- **Version comparison** — Comparing old vs. new planning sessions for the same site
- **Custom tag templates** — User-defined tag types beyond the standard platforms

---

## 15. Dependencies

| Dependency | Required For | Status |
|-----------|-------------|--------|
| Browserbase | Page capture, DOM extraction, screenshots | Existing |
| Claude API (Sonnet) | AI page analysis and recommendations | New integration (API key needed) |
| Supabase | Session storage, recommendations, outputs | Existing |
| React 19 + TypeScript | Frontend components | Existing |
| Node.js / Express | API endpoints | Existing |
| Canvas/Image processing library | Screenshot annotation overlays | New (e.g., sharp for server-side, or CSS overlays for client-side) |
| GTM Container JSON spec | Correct export format for GTM import | Reference documentation |

---

## 16. Glossary (Planning Mode Specific)

| Term | Definition |
|------|-----------|
| **Planning Session** | A single run of Planning Mode for one website. Contains discovered pages, AI recommendations, user decisions, and generated outputs. |
| **Page Capture** | The structured data extracted from a single page visit: DOM tree, interactive elements, forms, screenshots, existing tracking detection. |
| **AI Analysis** | Claude API's evaluation of a page capture, producing recommended elements to track with business justification and confidence scores. |
| **Recommendation** | A single AI-suggested element to track, with event name, parameters, priority, and business reasoning. |
| **Tracking Plan** | The complete set of approved recommendations across all pages — the user's approved measurement specification. |
| **GTM Container JSON** | A file in Google Tag Manager's export format containing tags, triggers, variables, and folders that can be imported directly into GTM. |
| **dataLayer Specification** | A developer-facing document containing all dataLayer.push() code snippets that need to be added to the website's source code. |
| **Implementation Guide** | A human-readable step-by-step document explaining how to use the generated outputs to set up tracking. |
| **Handoff** | The process of converting a completed Planning Mode session into a pre-populated Journey in Audit Mode, so the user can verify their implementation works. |
