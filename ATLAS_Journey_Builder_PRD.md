# ATLAS Journey Builder — Product Requirements Document

## Document Purpose

This PRD defines the Journey Builder feature for Atlas, the signal integrity auditing platform. It is intended to be consumed directly by Claude Code as the implementation specification. Every section includes enough detail to build from without further clarification.

---

## 1. Problem Statement

Atlas currently validates tracking signals by simulating user journeys via Browserbase and running 26 validation rules against captured data. However, the current system uses hardcoded journey paths and default event expectations. There is no mechanism for users to:

1. Define their own site funnel (what pages exist, in what order)
2. Specify what business actions happen on each page (purchases, form fills, sign-ups)
3. Choose which ad platforms they use (GA4, Meta, Google Ads, etc.)
4. Receive a generated dataLayer schema or WalkerOS config based on their specific setup
5. Compare expected signals against actual signals with a clear gap classification

The Journey Builder solves all five of these problems through a guided wizard that translates business intent into technical specifications.

### Target User

Non-technical marketing agency PMs and SMB marketers. They understand their business funnel ("people land, browse products, add to cart, buy") but do not understand dataLayer schemas, GTM containers, event parameters, or WalkerOS flow configurations.

### Design Constraint

Every question in the Journey Builder must be answerable by someone who has never opened Google Tag Manager. The system infers all technical requirements from business-level answers.

---

## 2. Feature Overview

The Journey Builder adds four major capabilities to Atlas:

| Capability | Description |
|-----------|-------------|
| **Guided Journey Wizard** | 4-step wizard (under 3 minutes) where users define their funnel, actions, and platforms |
| **Mapping Engine** | Declarative config that converts business-level journey definitions into platform-specific technical specs |
| **Dual Output Generator** | Produces both GTM dataLayer.push() snippets AND WalkerOS flow.json configurations |
| **Gap Report** | Compares expected signals (from journey definition) against actual signals (from Browserbase audit) and classifies gaps as MISSING or WRONG |

---

## 3. User Flow — Complete Step-by-Step

### 3.1 Entry Point

**Location:** Main dashboard, primary CTA button
**Label:** "Audit My Tracking" (new users) or "New Audit" (returning users)
**Behaviour:** Clicking opens the Journey Builder wizard as a full-page flow (not a modal)

### 3.2 Step 1 — Business Type Selection

**Screen title:** "What kind of site do you have?"
**UI:** 6 visual cards in a 2x3 or 3x2 grid. Each card has an icon, a title, and a one-line description.

| Card Title | Description | Template Loaded |
|-----------|-------------|----------------|
| Online Store | "You sell products online" | 6 stages: Landing → Category → Product → Add to Cart → Checkout → Purchase Confirmation |
| SaaS / Software | "You sell software or subscriptions" | 5 stages: Landing → Features → Pricing → Sign Up → Onboarding Complete |
| Lead Generation | "You collect leads via forms" | 4 stages: Landing → Service Pages → Contact Form → Thank You |
| Content / Media | "You publish content and grow audience" | 4 stages: Landing → Article → Newsletter Signup → Confirmation |
| Marketplace | "You connect buyers and sellers" | 5 stages: Landing → Search → Listing → Enquiry/Booking → Confirmation |
| Custom | "I'll build my own funnel" | 0 stages: empty canvas, user adds stages manually in Step 2 |

**User action:** Click one card. Advance to Step 2.

**Backend behaviour:** Load the corresponding journey template from the `journey_templates` table (system-seeded templates). This pre-populates Step 2 with stages and default action toggles.

### 3.3 Step 2 — Journey Stage Editor

**Screen title:** "Here's your customer journey — adjust it to match your site"
**UI:** Vertical or horizontal funnel visualisation. Each stage is a card connected by arrows/lines.

#### Stage Card Contents

Each card displays:

1. **Stage label** — editable inline text (click to rename). Default labels come from the template.
2. **Sample URL field** — text input with placeholder "Paste a page URL from your site (optional but recommended)"
3. **Action toggles** — expandable section (collapsed by default, with a "What happens here?" link to expand)

#### Stage Card Actions (User Can Do)

| Action | How |
|--------|-----|
| Rename a stage | Click the label text, type new name |
| Reorder stages | Drag and drop (handle icon on left side of card) |
| Add a stage | Click "+ Add Stage" button between any two stages, or at the end. Shows a dropdown of common page types: "Product Page", "Category Page", "Form Page", "Search Results", "Custom Page" |
| Remove a stage | Click X icon on the card. Confirm dialog: "Remove this stage? This won't affect your site." |
| Paste a URL | Type or paste into the URL field on each card |
| Toggle actions | Flip switches in the expandable "What happens here?" section |

#### Action Toggles (Plain English)

These are the business action toggles displayed inside each stage card. Each toggle is an on/off switch with a plain-English label:

| Toggle Label (What User Sees) | Internal Action Key | Default ON For These Stage Types |
|-------------------------------|--------------------|---------------------------------|
| "People buy something here" | `purchase` | Purchase Confirmation |
| "People add items to a cart here" | `add_to_cart` | Product Page, Listing Page |
| "People start the checkout process here" | `begin_checkout` | Checkout |
| "People fill out a form here" | `generate_lead` | Contact Form, Enquiry |
| "People sign up or create an account here" | `sign_up` | Sign Up, Newsletter Signup |
| "People view a specific product or listing here" | `view_item` | Product Page, Listing Page |
| "People browse a list or category here" | `view_item_list` | Category Page, Search Results |
| "People search for something here" | `search` | Search Results |
| "This page is important for ad tracking" | `ad_landing` | Landing Page (always) |

When a toggle is ON, Atlas knows to expect the corresponding event and parameters on that stage during the audit.

**Validation before proceeding:**
- At least 2 stages must exist
- At least 1 action toggle must be ON across all stages
- Show a soft warning (not a blocker) if no URLs are pasted: "Without URLs, Atlas can't simulate your site. You'll get a tracking spec but no audit results."

### 3.4 Step 3 — Platform & Destination Selection

**Screen title:** "Where do you send your tracking data?"
**UI:** Two sections stacked vertically.

#### Section A: Platform Checkboxes

Grid of platform cards with logos and checkboxes:

| Platform | Logo | Default State |
|----------|------|--------------|
| Google Analytics 4 | GA4 logo | Checked |
| Google Ads | Google Ads logo | Checked |
| Meta / Facebook | Meta logo | Checked |
| Server-side GTM (sGTM) | sGTM logo | Unchecked |
| TikTok | TikTok logo | Unchecked |
| LinkedIn | LinkedIn logo | Unchecked |

At least 1 platform must be selected to proceed.

For each selected platform, show an optional field for their measurement/pixel ID:
- GA4: "Measurement ID (e.g., G-XXXXXXX)" — optional
- Google Ads: "Conversion ID (e.g., AW-XXXXXXX)" — optional
- Meta: "Pixel ID (e.g., 1234567890)" — optional
- sGTM: "sGTM endpoint URL" — optional
- TikTok: "Pixel ID" — optional
- LinkedIn: "Partner ID" — optional

These IDs are optional for the audit (Atlas can detect them) but required for the generated code output. If not provided, the generated code will use placeholder values like `G-XXXXXXXXX` with a comment saying "Replace with your Measurement ID".

#### Section B: Implementation Format

**Label:** "How is tracking set up on your site?"

| Option | Label | Description |
|--------|-------|-------------|
| Radio 1 | "Google Tag Manager" | "Most common — we'll generate dataLayer.push() code" |
| Radio 2 | "WalkerOS" | "Config-as-code — we'll generate a flow.json file" |
| Radio 3 | "Both / Not sure" | "We'll generate both so you can compare" |

Default selection: "Google Tag Manager"

### 3.5 Step 4 — Review & Generate

**Screen title:** "Here's what Atlas will check"
**UI:** Clean summary card with all selections.

#### Summary Display Format

```
YOUR FUNNEL
Landing Page → Collections → Product Page → Cart → Checkout → Order Confirmation

KEY ACTIONS
• Purchase tracked on Order Confirmation
• Add to Cart tracked on Product Page
• View Item tracked on Product Page

PLATFORMS
Google Analytics 4, Google Ads, Meta Pixel

IMPLEMENTATION FORMAT
Google Tag Manager (dataLayer)

ATLAS WILL CHECK
[X] rules across [Y] funnel stages for [Z] platforms
```

The rule count X is calculated as: (number of enabled action toggles × platform-specific rules per action) + (global rules like gclid persistence, fbclid persistence, consent checks). Display as a single number, e.g., "34 signal rules across 6 funnel stages for 3 platforms".

#### Buttons

| Button | Behaviour |
|--------|-----------|
| "Run Audit" (primary) | Saves journey to Supabase, triggers Browserbase simulation, generates specs, runs validation. Goes to progress screen. |
| "Just Generate the Spec" (secondary) | Saves journey, generates the dataLayer/WalkerOS spec for download, but does NOT run the Browserbase simulation. Useful when user hasn't pasted URLs or just wants the code output. |
| "Back" | Returns to Step 3 |

### 3.6 Progress Screen

**Screen title:** "Atlas is checking your site..."
**UI:** Progress bar or stage-by-stage checklist.

Display each stage with a loading → complete → failed state:

```
✓ Landing Page — checked
✓ Collections — checked
◌ Product Page — checking...
○ Cart — waiting
○ Checkout — waiting
○ Order Confirmation — waiting
```

Expected duration: 30–60 seconds total (5–10 seconds per stage via Browserbase).

If a stage has no URL, show: "⊘ Cart — skipped (no URL provided)"

### 3.7 Results Screen — Gap Report

**Screen title:** "Your Signal Health Report"
**UI:** Same funnel visualisation from Step 2, but now each stage has a colour-coded status badge.

#### Status Badges

| Badge | Colour | Meaning |
|-------|--------|---------|
| ✓ Healthy | Green (#16A34A) | All expected signals found and correct |
| ⚠ Issues Found | Amber (#D97706) | Signals found but with parameter or format problems |
| ✗ Signals Missing | Red (#DC2626) | Expected signals not detected at all |
| — Not Checked | Grey (#94A3B8) | No URL provided, stage was skipped |

#### Stage Detail Panel

Clicking any stage opens a detail panel (slide-out or accordion) showing:

**For each gap found:**

```
GAP TYPE: [MISSING / WRONG] — [sub-type]
SEVERITY: [Critical / High / Medium / Info]

WHAT WAS EXPECTED:
[Plain English description, e.g., "A purchase event should fire here with your order ID and order total"]

WHAT WAS FOUND:
[Plain English description, e.g., "No purchase event was detected on this page"]

WHY THIS MATTERS:
[Business impact, e.g., "Google Ads and Meta cannot see your sales. Your ROAS will show as zero."]

WHO SHOULD FIX THIS:
[Role, e.g., "Your developer or GTM admin"]

HOW TO FIX IT:
[Code snippet or config change — shown in a copyable code block]
[Button: "Download fix for this stage"]

ESTIMATED EFFORT:
[Low (15 min) / Medium (1 hour) / High (half day)]
```

#### Gap Classification System

| Gap Type | Sub-Type | Description | Severity |
|----------|----------|-------------|----------|
| MISSING | `event_not_found` | The expected event never fired on this page | Critical |
| MISSING | `parameter_absent` | Event fired but a required parameter is empty or missing | High |
| MISSING | `platform_not_receiving` | Event fires locally (in dataLayer) but no corresponding network request to the ad platform endpoint | Critical |
| MISSING | `platform_tag_absent` | The ad platform's base tag/pixel is not loaded on the page | Critical |
| WRONG | `parameter_format` | Parameter exists but format is incorrect for the platform (e.g., Meta expects array, got string) | Medium |
| WRONG | `value_mismatch` | Parameter exists but value differs between platforms (e.g., GA4 got 99.00, Meta got 0) | High |
| WRONG | `duplicate_event` | Same event fires multiple times on one page (double-counting risk) | High |
| WRONG | `id_persistence_broken` | Click ID (gclid/fbclid) was captured on landing but lost by conversion page | Critical |
| WRONG | `pii_not_hashed` | User data (email/phone) sent in plaintext instead of hashed | High |
| WRONG | `consent_blocking` | Consent management is preventing events from firing (may be intentional) | Medium |
| EXTRA | `unexpected_event` | An event fires that wasn't in the journey definition (informational) | Info |

#### Summary Metrics

At the top of the results screen, display the 4 existing Atlas scoring metrics:

1. **Conversion Signal Health** (0–100 score)
2. **Attribution Risk Level** (Low / Medium / High / Critical)
3. **Optimization Strength** (Weak / Moderate / Strong)
4. **Data Consistency Score** (Low / Medium / High)

These are calculated from the gap findings against the journey definition, using the existing Atlas scoring engine logic.

#### Export Options

| Button | Output |
|--------|--------|
| "Download Report (PDF)" | 5-page marketing-friendly report (existing Atlas report format) enhanced with journey-specific context |
| "Download Tracking Spec" | ZIP containing: dataLayer snippets (if GTM selected), WalkerOS flow.json (if WalkerOS selected), validation spec JSON |
| "Download Raw Data (JSON)" | Full audit capture data for developers |
| "Share Report" | Generates a shareable link (read-only, expires in 30 days) |

---

## 4. Mapping Engine — Technical Specification

The Mapping Engine is the core system component that translates journey definitions into technical specifications. It is a three-layer architecture.

### 4.1 Layer 1 — Action Primitives

Action Primitives are the system-maintained master list of business actions. Each primitive defines what event name and parameters are required, regardless of platform.

```typescript
// File: src/mapping-engine/action-primitives.ts

export interface ActionPrimitive {
  key: string;                    // Internal identifier (e.g., 'purchase')
  label: string;                  // User-facing label (e.g., 'People buy something here')
  description: string;            // Tooltip text for the wizard
  category: 'conversion' | 'engagement' | 'navigation';
  required_params: ParamSpec[];   // Parameters that MUST be present
  optional_params: ParamSpec[];   // Parameters that SHOULD be present (warnings if missing)
  platform_mappings: PlatformMapping[];  // How this action maps to each platform
}

export interface ParamSpec {
  key: string;                    // Internal key (e.g., 'transaction_id')
  label: string;                  // Human-readable name (e.g., 'Order ID')
  type: 'string' | 'number' | 'array' | 'object' | 'boolean';
  description: string;            // What this parameter is, in plain English
  example: string;                // Example value (e.g., 'ORDER-12345')
  validation_regex?: string;      // Optional regex for format validation
}

export interface PlatformMapping {
  platform: 'ga4' | 'meta' | 'google_ads' | 'sgtm' | 'tiktok' | 'linkedin';
  event_name: string;             // Platform-specific event name
  param_mapping: Record<string, string>;  // Maps internal param keys to platform-specific keys
  payload_template: string;       // Template string for code generation
  additional_params?: Record<string, any>; // Platform-specific extra params
}
```

#### Complete Action Primitive Definitions

```typescript
export const ACTION_PRIMITIVES: ActionPrimitive[] = [
  {
    key: 'purchase',
    label: 'People buy something here',
    description: 'A transaction is completed on this page',
    category: 'conversion',
    required_params: [
      {
        key: 'transaction_id',
        label: 'Order ID',
        type: 'string',
        description: 'Unique identifier for this order from your system',
        example: 'ORDER-12345'
      },
      {
        key: 'value',
        label: 'Order Total',
        type: 'number',
        description: 'Total value of the order',
        example: '99.99'
      },
      {
        key: 'currency',
        label: 'Currency',
        type: 'string',
        description: 'Currency code (e.g., USD, SGD, EUR)',
        example: 'USD'
      }
    ],
    optional_params: [
      {
        key: 'items',
        label: 'Products Purchased',
        type: 'array',
        description: 'Array of product objects with name, id, price, quantity',
        example: '[{item_id: "SKU-1", item_name: "Widget", price: 29.99, quantity: 2}]'
      },
      {
        key: 'tax',
        label: 'Tax Amount',
        type: 'number',
        description: 'Tax amount for the order',
        example: '8.50'
      },
      {
        key: 'shipping',
        label: 'Shipping Cost',
        type: 'number',
        description: 'Shipping cost for the order',
        example: '5.99'
      },
      {
        key: 'coupon',
        label: 'Coupon Code',
        type: 'string',
        description: 'Coupon or discount code used',
        example: 'SAVE10'
      },
      {
        key: 'user_email',
        label: 'Customer Email',
        type: 'string',
        description: 'Customer email address (will be hashed for ad platforms)',
        example: 'customer@example.com'
      },
      {
        key: 'user_phone',
        label: 'Customer Phone',
        type: 'string',
        description: 'Customer phone number (will be hashed for ad platforms)',
        example: '+6591234567'
      }
    ],
    platform_mappings: [
      {
        platform: 'ga4',
        event_name: 'purchase',
        param_mapping: {
          transaction_id: 'transaction_id',
          value: 'value',
          currency: 'currency',
          items: 'items',
          tax: 'tax',
          shipping: 'shipping',
          coupon: 'coupon'
        },
        payload_template: 'ga4_purchase',
        additional_params: {}
      },
      {
        platform: 'meta',
        event_name: 'Purchase',
        param_mapping: {
          transaction_id: 'order_id',
          value: 'value',
          currency: 'currency',
          items: 'content_ids',
          user_email: 'em',
          user_phone: 'ph'
        },
        payload_template: 'meta_purchase',
        additional_params: {
          content_type: 'product'
        }
      },
      {
        platform: 'google_ads',
        event_name: 'conversion',
        param_mapping: {
          transaction_id: 'transaction_id',
          value: 'value',
          currency: 'currency'
        },
        payload_template: 'gads_conversion',
        additional_params: {
          send_to: '{{GOOGLE_ADS_CONVERSION_ID}}/{{CONVERSION_LABEL}}'
        }
      },
      {
        platform: 'tiktok',
        event_name: 'CompletePayment',
        param_mapping: {
          transaction_id: 'order_id',
          value: 'value',
          currency: 'currency',
          items: 'contents'
        },
        payload_template: 'tiktok_purchase',
        additional_params: {}
      },
      {
        platform: 'linkedin',
        event_name: 'conversion',
        param_mapping: {
          value: 'value',
          currency: 'currency'
        },
        payload_template: 'linkedin_conversion',
        additional_params: {
          conversion_id: '{{LINKEDIN_CONVERSION_ID}}'
        }
      }
    ]
  },

  {
    key: 'add_to_cart',
    label: 'People add items to a cart here',
    description: 'Users add a product or item to their shopping cart',
    category: 'engagement',
    required_params: [
      {
        key: 'value',
        label: 'Cart Value',
        type: 'number',
        description: 'Value of the item(s) added',
        example: '29.99'
      },
      {
        key: 'currency',
        label: 'Currency',
        type: 'string',
        description: 'Currency code',
        example: 'USD'
      }
    ],
    optional_params: [
      {
        key: 'items',
        label: 'Products Added',
        type: 'array',
        description: 'Array of product objects',
        example: '[{item_id: "SKU-1", item_name: "Widget", price: 29.99, quantity: 1}]'
      }
    ],
    platform_mappings: [
      {
        platform: 'ga4',
        event_name: 'add_to_cart',
        param_mapping: { value: 'value', currency: 'currency', items: 'items' },
        payload_template: 'ga4_add_to_cart',
        additional_params: {}
      },
      {
        platform: 'meta',
        event_name: 'AddToCart',
        param_mapping: { value: 'value', currency: 'currency', items: 'content_ids' },
        payload_template: 'meta_add_to_cart',
        additional_params: { content_type: 'product' }
      },
      {
        platform: 'google_ads',
        event_name: 'add_to_cart',
        param_mapping: { value: 'value', currency: 'currency', items: 'items' },
        payload_template: 'gads_add_to_cart',
        additional_params: {}
      },
      {
        platform: 'tiktok',
        event_name: 'AddToCart',
        param_mapping: { value: 'value', currency: 'currency', items: 'contents' },
        payload_template: 'tiktok_add_to_cart',
        additional_params: {}
      }
    ]
  },

  {
    key: 'begin_checkout',
    label: 'People start the checkout process here',
    description: 'Users initiate the checkout flow',
    category: 'engagement',
    required_params: [
      {
        key: 'value',
        label: 'Cart Value',
        type: 'number',
        description: 'Total value of items in cart',
        example: '149.97'
      },
      {
        key: 'currency',
        label: 'Currency',
        type: 'string',
        description: 'Currency code',
        example: 'USD'
      }
    ],
    optional_params: [
      {
        key: 'items',
        label: 'Products in Cart',
        type: 'array',
        description: 'Array of product objects in the cart',
        example: '[{item_id: "SKU-1", item_name: "Widget", price: 29.99, quantity: 2}]'
      },
      {
        key: 'coupon',
        label: 'Coupon Code',
        type: 'string',
        description: 'Applied coupon or discount code',
        example: 'SAVE10'
      }
    ],
    platform_mappings: [
      {
        platform: 'ga4',
        event_name: 'begin_checkout',
        param_mapping: { value: 'value', currency: 'currency', items: 'items', coupon: 'coupon' },
        payload_template: 'ga4_begin_checkout',
        additional_params: {}
      },
      {
        platform: 'meta',
        event_name: 'InitiateCheckout',
        param_mapping: { value: 'value', currency: 'currency', items: 'content_ids' },
        payload_template: 'meta_initiate_checkout',
        additional_params: { content_type: 'product' }
      },
      {
        platform: 'tiktok',
        event_name: 'InitiateCheckout',
        param_mapping: { value: 'value', currency: 'currency', items: 'contents' },
        payload_template: 'tiktok_initiate_checkout',
        additional_params: {}
      }
    ]
  },

  {
    key: 'generate_lead',
    label: 'People fill out a form here',
    description: 'Users submit a contact form, enquiry, or lead capture form',
    category: 'conversion',
    required_params: [
      {
        key: 'form_id',
        label: 'Form Name',
        type: 'string',
        description: 'Identifier for which form was submitted',
        example: 'contact_form_main'
      }
    ],
    optional_params: [
      {
        key: 'value',
        label: 'Lead Value',
        type: 'number',
        description: 'Estimated value of this lead (if known)',
        example: '50.00'
      },
      {
        key: 'currency',
        label: 'Currency',
        type: 'string',
        description: 'Currency code for lead value',
        example: 'USD'
      },
      {
        key: 'user_email',
        label: 'Email Address',
        type: 'string',
        description: 'Lead email (will be hashed for ad platforms)',
        example: 'lead@example.com'
      },
      {
        key: 'user_phone',
        label: 'Phone Number',
        type: 'string',
        description: 'Lead phone (will be hashed for ad platforms)',
        example: '+6591234567'
      }
    ],
    platform_mappings: [
      {
        platform: 'ga4',
        event_name: 'generate_lead',
        param_mapping: { form_id: 'form_id', value: 'value', currency: 'currency' },
        payload_template: 'ga4_generate_lead',
        additional_params: {}
      },
      {
        platform: 'meta',
        event_name: 'Lead',
        param_mapping: { value: 'value', currency: 'currency', user_email: 'em', user_phone: 'ph' },
        payload_template: 'meta_lead',
        additional_params: {}
      },
      {
        platform: 'google_ads',
        event_name: 'conversion',
        param_mapping: { value: 'value', currency: 'currency' },
        payload_template: 'gads_lead_conversion',
        additional_params: { send_to: '{{GOOGLE_ADS_CONVERSION_ID}}/{{CONVERSION_LABEL}}' }
      },
      {
        platform: 'tiktok',
        event_name: 'SubmitForm',
        param_mapping: { value: 'value', currency: 'currency' },
        payload_template: 'tiktok_submit_form',
        additional_params: {}
      },
      {
        platform: 'linkedin',
        event_name: 'conversion',
        param_mapping: { value: 'value', currency: 'currency' },
        payload_template: 'linkedin_lead_conversion',
        additional_params: { conversion_id: '{{LINKEDIN_CONVERSION_ID}}' }
      }
    ]
  },

  {
    key: 'sign_up',
    label: 'People sign up or create an account here',
    description: 'Users register for an account, trial, or newsletter',
    category: 'conversion',
    required_params: [
      {
        key: 'method',
        label: 'Sign Up Method',
        type: 'string',
        description: 'How the user signed up (email, Google, Facebook, etc.)',
        example: 'email'
      }
    ],
    optional_params: [
      {
        key: 'user_id',
        label: 'User ID',
        type: 'string',
        description: 'Your system user ID for the new account',
        example: 'USR-78901'
      },
      {
        key: 'user_email',
        label: 'Email Address',
        type: 'string',
        description: 'User email (will be hashed for ad platforms)',
        example: 'user@example.com'
      }
    ],
    platform_mappings: [
      {
        platform: 'ga4',
        event_name: 'sign_up',
        param_mapping: { method: 'method' },
        payload_template: 'ga4_sign_up',
        additional_params: {}
      },
      {
        platform: 'meta',
        event_name: 'CompleteRegistration',
        param_mapping: { method: 'content_name', user_email: 'em' },
        payload_template: 'meta_complete_registration',
        additional_params: { status: 'true' }
      },
      {
        platform: 'tiktok',
        event_name: 'CompleteRegistration',
        param_mapping: { method: 'content_name' },
        payload_template: 'tiktok_complete_registration',
        additional_params: {}
      }
    ]
  },

  {
    key: 'view_item',
    label: 'People view a specific product or listing here',
    description: 'Users view a product detail page or individual listing',
    category: 'engagement',
    required_params: [
      {
        key: 'items',
        label: 'Product Viewed',
        type: 'array',
        description: 'Product details (at minimum: name and ID)',
        example: '[{item_id: "SKU-1", item_name: "Widget", price: 29.99}]'
      }
    ],
    optional_params: [
      {
        key: 'value',
        label: 'Product Value',
        type: 'number',
        description: 'Price of the viewed product',
        example: '29.99'
      },
      {
        key: 'currency',
        label: 'Currency',
        type: 'string',
        description: 'Currency code',
        example: 'USD'
      }
    ],
    platform_mappings: [
      {
        platform: 'ga4',
        event_name: 'view_item',
        param_mapping: { items: 'items', value: 'value', currency: 'currency' },
        payload_template: 'ga4_view_item',
        additional_params: {}
      },
      {
        platform: 'meta',
        event_name: 'ViewContent',
        param_mapping: { items: 'content_ids', value: 'value', currency: 'currency' },
        payload_template: 'meta_view_content',
        additional_params: { content_type: 'product' }
      },
      {
        platform: 'tiktok',
        event_name: 'ViewContent',
        param_mapping: { items: 'contents', value: 'value', currency: 'currency' },
        payload_template: 'tiktok_view_content',
        additional_params: {}
      }
    ]
  },

  {
    key: 'view_item_list',
    label: 'People browse a list or category here',
    description: 'Users view a category page, search results, or product listing',
    category: 'engagement',
    required_params: [
      {
        key: 'item_list_name',
        label: 'List/Category Name',
        type: 'string',
        description: 'Name of the category or list being viewed',
        example: 'Summer Collection'
      }
    ],
    optional_params: [
      {
        key: 'items',
        label: 'Products in List',
        type: 'array',
        description: 'Array of products shown on the page',
        example: '[{item_id: "SKU-1", item_name: "Widget", price: 29.99}]'
      }
    ],
    platform_mappings: [
      {
        platform: 'ga4',
        event_name: 'view_item_list',
        param_mapping: { item_list_name: 'item_list_name', items: 'items' },
        payload_template: 'ga4_view_item_list',
        additional_params: {}
      }
    ]
  },

  {
    key: 'search',
    label: 'People search for something here',
    description: 'Users perform a site search',
    category: 'engagement',
    required_params: [
      {
        key: 'search_term',
        label: 'Search Term',
        type: 'string',
        description: 'What the user searched for',
        example: 'blue widget'
      }
    ],
    optional_params: [],
    platform_mappings: [
      {
        platform: 'ga4',
        event_name: 'search',
        param_mapping: { search_term: 'search_term' },
        payload_template: 'ga4_search',
        additional_params: {}
      },
      {
        platform: 'meta',
        event_name: 'Search',
        param_mapping: { search_term: 'search_string' },
        payload_template: 'meta_search',
        additional_params: {}
      },
      {
        platform: 'tiktok',
        event_name: 'Search',
        param_mapping: { search_term: 'query' },
        payload_template: 'tiktok_search',
        additional_params: {}
      }
    ]
  }
];
```

### 4.2 Layer 2 — Platform Schema Definitions

Each platform has a schema definition that specifies how events should be formatted and delivered.

```typescript
// File: src/mapping-engine/platform-schemas.ts

export interface PlatformSchema {
  platform: string;
  display_name: string;
  detection: PlatformDetection;       // How Atlas detects this platform during audit
  delivery: PlatformDelivery;         // How events are sent to this platform
  user_data_handling: UserDataConfig; // How PII is handled (hashing requirements)
  click_id: ClickIdConfig | null;     // Click ID persistence requirements
}

export interface PlatformDetection {
  script_patterns: string[];          // URL patterns for platform scripts
  network_patterns: string[];         // URL patterns for outbound event requests
  datalayer_markers: string[];        // dataLayer properties that indicate this platform
  global_objects: string[];           // window.* objects to check (e.g., 'fbq', 'gtag')
}

export interface PlatformDelivery {
  method: 'script_tag' | 'network_request' | 'server_side';
  endpoint_patterns: string[];        // Where events are sent
  required_identifiers: string[];     // IDs needed (measurement_id, pixel_id, etc.)
}

export interface UserDataConfig {
  supports_enhanced_conversions: boolean;
  hashing_required: boolean;
  hash_algorithm: 'sha256' | 'none';
  hashable_fields: string[];          // Which user data fields must be hashed
}

export interface ClickIdConfig {
  param_name: string;                 // URL parameter name (gclid, fbclid, etc.)
  storage_method: 'cookie' | 'localstorage' | 'url';
  persistence_required: boolean;      // Must survive from landing to conversion
  cookie_name?: string;               // Cookie name if applicable
}

export const PLATFORM_SCHEMAS: PlatformSchema[] = [
  {
    platform: 'ga4',
    display_name: 'Google Analytics 4',
    detection: {
      script_patterns: ['googletagmanager.com/gtag', 'google-analytics.com/g/collect'],
      network_patterns: ['google-analytics.com/g/collect', 'analytics.google.com'],
      datalayer_markers: ['gtag'],
      global_objects: ['gtag', 'google_tag_manager']
    },
    delivery: {
      method: 'script_tag',
      endpoint_patterns: ['google-analytics.com/g/collect'],
      required_identifiers: ['measurement_id']
    },
    user_data_handling: {
      supports_enhanced_conversions: true,
      hashing_required: false,
      hash_algorithm: 'sha256',
      hashable_fields: ['user_email', 'user_phone', 'user_address']
    },
    click_id: null
  },
  {
    platform: 'google_ads',
    display_name: 'Google Ads',
    detection: {
      script_patterns: ['googletagmanager.com/gtag', 'googleadservices.com/pagead/conversion'],
      network_patterns: ['googleadservices.com/pagead/conversion', 'google.com/pagead'],
      datalayer_markers: ['google_tag_params'],
      global_objects: ['gtag']
    },
    delivery: {
      method: 'script_tag',
      endpoint_patterns: ['googleadservices.com/pagead/conversion'],
      required_identifiers: ['conversion_id', 'conversion_label']
    },
    user_data_handling: {
      supports_enhanced_conversions: true,
      hashing_required: true,
      hash_algorithm: 'sha256',
      hashable_fields: ['user_email', 'user_phone']
    },
    click_id: {
      param_name: 'gclid',
      storage_method: 'cookie',
      persistence_required: true,
      cookie_name: '_gcl_aw'
    }
  },
  {
    platform: 'meta',
    display_name: 'Meta / Facebook',
    detection: {
      script_patterns: ['connect.facebook.net/en_US/fbevents.js'],
      network_patterns: ['facebook.com/tr', 'facebook.com/tr/'],
      datalayer_markers: [],
      global_objects: ['fbq', '_fbq']
    },
    delivery: {
      method: 'script_tag',
      endpoint_patterns: ['facebook.com/tr'],
      required_identifiers: ['pixel_id']
    },
    user_data_handling: {
      supports_enhanced_conversions: true,
      hashing_required: true,
      hash_algorithm: 'sha256',
      hashable_fields: ['em', 'ph', 'fn', 'ln', 'ct', 'st', 'zp', 'country']
    },
    click_id: {
      param_name: 'fbclid',
      storage_method: 'cookie',
      persistence_required: true,
      cookie_name: '_fbc'
    }
  },
  {
    platform: 'sgtm',
    display_name: 'Server-side GTM',
    detection: {
      script_patterns: [],
      network_patterns: [],
      datalayer_markers: ['transport_url'],
      global_objects: []
    },
    delivery: {
      method: 'server_side',
      endpoint_patterns: [],
      required_identifiers: ['transport_url']
    },
    user_data_handling: {
      supports_enhanced_conversions: true,
      hashing_required: false,
      hash_algorithm: 'sha256',
      hashable_fields: ['user_email', 'user_phone']
    },
    click_id: null
  },
  {
    platform: 'tiktok',
    display_name: 'TikTok',
    detection: {
      script_patterns: ['analytics.tiktok.com/i18n/pixel/events.js'],
      network_patterns: ['analytics.tiktok.com/api/v2/pixel'],
      datalayer_markers: [],
      global_objects: ['ttq']
    },
    delivery: {
      method: 'script_tag',
      endpoint_patterns: ['analytics.tiktok.com/api/v2/pixel'],
      required_identifiers: ['pixel_id']
    },
    user_data_handling: {
      supports_enhanced_conversions: true,
      hashing_required: true,
      hash_algorithm: 'sha256',
      hashable_fields: ['email', 'phone_number']
    },
    click_id: {
      param_name: 'ttclid',
      storage_method: 'cookie',
      persistence_required: true,
      cookie_name: '_ttp'
    }
  },
  {
    platform: 'linkedin',
    display_name: 'LinkedIn',
    detection: {
      script_patterns: ['snap.licdn.com/li.lms-analytics/insight.min.js'],
      network_patterns: ['px.ads.linkedin.com', 'dc.ads.linkedin.com'],
      datalayer_markers: [],
      global_objects: ['_linkedin_partner_id', 'lintrk']
    },
    delivery: {
      method: 'script_tag',
      endpoint_patterns: ['px.ads.linkedin.com'],
      required_identifiers: ['partner_id']
    },
    user_data_handling: {
      supports_enhanced_conversions: false,
      hashing_required: false,
      hash_algorithm: 'none',
      hashable_fields: []
    },
    click_id: {
      param_name: 'li_fat_id',
      storage_method: 'cookie',
      persistence_required: true,
      cookie_name: 'li_fat_id'
    }
  }
];
```

### 4.3 Layer 3 — Output Generators

Two output generators must be implemented. Both take the same input (resolved journey definition + platform configs) and produce different output formats.

#### 4.3.1 GTM dataLayer Output Generator

```typescript
// File: src/mapping-engine/generators/gtm-datalayer.ts

export interface GTMDataLayerOutput {
  stages: GTMStageOutput[];
  global_setup: string;              // Base GTM container snippet + config
}

export interface GTMStageOutput {
  stage_label: string;
  stage_order: number;
  sample_url: string | null;
  code_snippet: string;              // Complete dataLayer.push() code for this stage
  comments: string[];                // Inline comments explaining what each part does
}

/**
 * Generates GTM dataLayer.push() code for a given journey.
 *
 * For each stage:
 * 1. Look up which action toggles are ON
 * 2. For each ON action, get the action primitive
 * 3. For each selected platform, get the platform mapping
 * 4. Generate a single dataLayer.push() call that includes all required data
 *    (GA4, Meta, and Google Ads all read from the same dataLayer)
 * 5. Wrap in developer-friendly comments
 *
 * IMPORTANT: The generated code uses the "universal dataLayer" pattern.
 * One dataLayer.push() call contains all the data that GTM tags will
 * pick up. Individual GTM tags (GA4 tag, Meta CAPI tag, etc.) are
 * configured inside GTM to read from these dataLayer variables.
 */
export function generateGTMDataLayer(
  journey: JourneyDefinition,
  platforms: PlatformConfig[]
): GTMDataLayerOutput {
  // Implementation here
}
```

**Example output for an ecommerce Purchase Confirmation stage:**

```javascript
// =============================================================
// STAGE: Purchase Confirmation
// URL: https://example.com/order-confirmation
// Events: purchase
// Platforms: GA4, Meta, Google Ads
// Generated by Atlas — do not edit directly
// =============================================================

// Fire this code when the order confirmation page loads.
// Replace placeholder values with your actual order data.

window.dataLayer = window.dataLayer || [];
window.dataLayer.push({
  event: 'purchase',
  ecommerce: {
    transaction_id: '{{ORDER_ID}}',         // REQUIRED: Your unique order ID
    value: {{ORDER_TOTAL}},                  // REQUIRED: Total order value (number)
    currency: '{{CURRENCY_CODE}}',           // REQUIRED: e.g., 'USD', 'SGD'
    tax: {{TAX_AMOUNT}},                     // Optional: Tax amount
    shipping: {{SHIPPING_COST}},             // Optional: Shipping cost
    coupon: '{{COUPON_CODE}}',               // Optional: Coupon used
    items: [
      {
        item_id: '{{PRODUCT_SKU}}',          // Product ID/SKU
        item_name: '{{PRODUCT_NAME}}',       // Product name
        price: {{PRODUCT_PRICE}},            // Unit price
        quantity: {{PRODUCT_QUANTITY}}        // Quantity purchased
      }
      // Repeat for each product in the order
    ]
  },
  // Enhanced Conversions data (for Google Ads + Meta CAPI)
  user_data: {
    email: '{{CUSTOMER_EMAIL}}',             // Optional: Hashed automatically by GTM
    phone_number: '{{CUSTOMER_PHONE}}'       // Optional: Hashed automatically by GTM
  }
});
```

#### 4.3.2 WalkerOS Output Generator

```typescript
// File: src/mapping-engine/generators/walkeros-flow.ts

export interface WalkerOSOutput {
  flow_json: object;                 // Complete flow.json configuration
  elb_tags: WalkerOSTagOutput[];     // Per-stage elb() calls or data attributes
  readme: string;                    // Setup instructions
}

export interface WalkerOSTagOutput {
  stage_label: string;
  stage_order: number;
  sample_url: string | null;
  tagging_method: 'data_attributes' | 'elb_calls';
  code_snippet: string;
  comments: string[];
}

/**
 * Generates WalkerOS flow.json + tagging code for a given journey.
 *
 * The flow.json includes:
 * - sources: web source configuration
 * - destinations: one entry per selected platform (GA4, Meta, etc.)
 * - mapping: event transformation rules per destination
 *
 * The tagging code uses WalkerOS elb() calls or HTML data attributes
 * depending on the implementation preference.
 */
export function generateWalkerOSFlow(
  journey: JourneyDefinition,
  platforms: PlatformConfig[]
): WalkerOSOutput {
  // Implementation here
}
```

**Example flow.json output for an ecommerce site with GA4 + Meta:**

```json
{
  "version": "1.0",
  "sources": {
    "web": {
      "default": true,
      "consent": {
        "functional": {
          "required": true
        },
        "marketing": {
          "required": false
        }
      }
    }
  },
  "destinations": {
    "ga4": {
      "package": "@walkeros/destination-ga4",
      "config": {
        "measurement_id": "G-XXXXXXXXX"
      },
      "consent": {
        "functional": true
      },
      "mapping": {
        "product action": {
          "name": "purchase",
          "data": {
            "transaction_id": "data.transaction_id",
            "value": "data.value",
            "currency": "data.currency",
            "items": "data.items"
          }
        },
        "product add": {
          "name": "add_to_cart",
          "data": {
            "value": "data.value",
            "currency": "data.currency",
            "items": "data.items"
          }
        }
      }
    },
    "meta": {
      "package": "@walkeros/destination-meta",
      "config": {
        "pixel_id": "1234567890"
      },
      "consent": {
        "marketing": true
      },
      "mapping": {
        "product action": {
          "name": "Purchase",
          "data": {
            "value": "data.value",
            "currency": "data.currency",
            "content_ids": "data.items.*.item_id",
            "content_type": "product"
          }
        },
        "product add": {
          "name": "AddToCart",
          "data": {
            "value": "data.value",
            "currency": "data.currency",
            "content_ids": "data.items.*.item_id",
            "content_type": "product"
          }
        }
      }
    }
  }
}
```

### 4.4 Validation Spec Generator

In addition to implementation code, the Mapping Engine generates a validation spec that the Atlas audit engine consumes. This tells the auditor exactly what to check on each stage.

```typescript
// File: src/mapping-engine/generators/validation-spec.ts

export interface ValidationSpec {
  journey_id: string;
  stages: StageValidationSpec[];
  global_checks: GlobalCheck[];      // Cross-stage checks (e.g., click ID persistence)
}

export interface StageValidationSpec {
  stage_order: number;
  stage_label: string;
  sample_url: string | null;
  expected_events: ExpectedEvent[];
  expected_platforms: ExpectedPlatform[];
}

export interface ExpectedEvent {
  action_key: string;                // e.g., 'purchase'
  event_name_by_platform: Record<string, string>;  // e.g., { ga4: 'purchase', meta: 'Purchase' }
  required_params: string[];         // Param keys that must be present
  optional_params: string[];         // Param keys that should be present (warning if missing)
}

export interface ExpectedPlatform {
  platform: string;
  must_detect_tag: boolean;          // Should the platform's base tag be on this page?
  must_receive_event: boolean;       // Should a network request to this platform be observed?
  endpoint_patterns: string[];       // Network URL patterns to look for
}

export interface GlobalCheck {
  check_type: 'click_id_persistence' | 'event_id_deduplication' | 'consent_enforcement' | 'pii_hashing';
  platform: string;
  description: string;
  params: Record<string, any>;
}
```

---

## 5. Database Schema (Supabase)

### 5.1 New Tables

```sql
-- ============================================================
-- JOURNEY BUILDER TABLES
-- ============================================================

-- Stores user-defined journeys
CREATE TABLE journeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Untitled Journey',
  business_type TEXT NOT NULL CHECK (business_type IN (
    'ecommerce', 'saas', 'lead_gen', 'content', 'marketplace', 'custom'
  )),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  implementation_format TEXT NOT NULL DEFAULT 'gtm' CHECK (implementation_format IN ('gtm', 'walkeros', 'both')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Individual stages within a journey
CREATE TABLE journey_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id UUID NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  stage_order INTEGER NOT NULL,
  label TEXT NOT NULL,
  page_type TEXT NOT NULL DEFAULT 'custom' CHECK (page_type IN (
    'landing', 'category', 'product', 'cart', 'checkout', 'confirmation',
    'search_results', 'form', 'sign_up', 'pricing', 'features',
    'article', 'listing', 'booking', 'custom'
  )),
  sample_url TEXT,
  actions TEXT[] NOT NULL DEFAULT '{}',    -- Array of action primitive keys enabled on this stage
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(journey_id, stage_order)
);

-- Platform configurations for a journey
CREATE TABLE journey_platforms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id UUID NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN (
    'ga4', 'google_ads', 'meta', 'sgtm', 'tiktok', 'linkedin'
  )),
  is_active BOOLEAN NOT NULL DEFAULT true,
  measurement_id TEXT,                      -- Platform-specific ID (optional)
  config JSONB DEFAULT '{}',                -- Additional platform config
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(journey_id, platform)
);

-- Generated technical specs
CREATE TABLE generated_specs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id UUID NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  format TEXT NOT NULL CHECK (format IN ('gtm_datalayer', 'walkeros_flow', 'validation_spec')),
  spec_data JSONB NOT NULL,                 -- The generated specification
  version INTEGER NOT NULL DEFAULT 1,       -- Increments on regeneration
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Audit results linked to journey stages
CREATE TABLE journey_audit_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,   -- Links to existing audits table
  journey_id UUID NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  stage_id UUID NOT NULL REFERENCES journey_stages(id) ON DELETE CASCADE,
  stage_status TEXT NOT NULL CHECK (stage_status IN ('healthy', 'issues_found', 'signals_missing', 'not_checked')),
  gaps JSONB NOT NULL DEFAULT '[]',         -- Array of Gap objects (see Gap Classification)
  raw_capture JSONB,                         -- Raw Browserbase capture data for this stage
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Gap structure within the gaps JSONB array:
-- {
--   "gap_type": "MISSING" | "WRONG" | "EXTRA",
--   "sub_type": "event_not_found" | "parameter_absent" | "platform_not_receiving" | etc.,
--   "severity": "critical" | "high" | "medium" | "info",
--   "action_key": "purchase",
--   "platform": "meta",
--   "expected": "Purchase event with value and currency",
--   "found": "No Purchase event detected",
--   "business_impact": "Meta cannot see your sales. ROAS will show as zero.",
--   "fix_owner": "Developer or GTM Admin",
--   "fix_description": "Add fbq('track', 'Purchase', ...) to the confirmation page",
--   "fix_code": "fbq('track', 'Purchase', {value: ORDER_TOTAL, currency: 'USD'});",
--   "estimated_effort": "low"
-- }

-- Reusable journey templates (agency feature)
CREATE TABLE journey_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,   -- NULL = system template
  name TEXT NOT NULL,
  description TEXT,
  business_type TEXT NOT NULL,
  is_system BOOLEAN NOT NULL DEFAULT false,  -- true = pre-seeded by Atlas
  is_shared BOOLEAN NOT NULL DEFAULT false,  -- true = visible to all users in same org
  template_data JSONB NOT NULL,              -- Snapshot of stages + actions (no URLs or IDs)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- System-maintained action primitives (reference table)
CREATE TABLE action_primitives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('conversion', 'engagement', 'navigation')),
  required_params JSONB NOT NULL DEFAULT '[]',
  optional_params JSONB NOT NULL DEFAULT '[]',
  platform_mappings JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_journeys_user_id ON journeys(user_id);
CREATE INDEX idx_journeys_status ON journeys(status);
CREATE INDEX idx_journey_stages_journey_id ON journey_stages(journey_id);
CREATE INDEX idx_journey_platforms_journey_id ON journey_platforms(journey_id);
CREATE INDEX idx_generated_specs_journey_id ON generated_specs(journey_id);
CREATE INDEX idx_journey_audit_results_audit_id ON journey_audit_results(audit_id);
CREATE INDEX idx_journey_audit_results_journey_id ON journey_audit_results(journey_id);
CREATE INDEX idx_journey_templates_business_type ON journey_templates(business_type);
CREATE INDEX idx_journey_templates_user_id ON journey_templates(user_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE journeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_platforms ENABLE ROW LEVEL SECURITY;
ALTER TABLE generated_specs ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_audit_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_primitives ENABLE ROW LEVEL SECURITY;

-- Users can only access their own journeys
CREATE POLICY "Users can CRUD own journeys" ON journeys
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can CRUD own journey stages" ON journey_stages
  FOR ALL USING (journey_id IN (SELECT id FROM journeys WHERE user_id = auth.uid()));

CREATE POLICY "Users can CRUD own journey platforms" ON journey_platforms
  FOR ALL USING (journey_id IN (SELECT id FROM journeys WHERE user_id = auth.uid()));

CREATE POLICY "Users can read own generated specs" ON generated_specs
  FOR ALL USING (journey_id IN (SELECT id FROM journeys WHERE user_id = auth.uid()));

CREATE POLICY "Users can read own audit results" ON journey_audit_results
  FOR ALL USING (journey_id IN (SELECT id FROM journeys WHERE user_id = auth.uid()));

-- Templates: users see system templates + their own + shared templates from their org
CREATE POLICY "Users can read available templates" ON journey_templates
  FOR SELECT USING (is_system = true OR user_id = auth.uid() OR is_shared = true);

CREATE POLICY "Users can CRUD own templates" ON journey_templates
  FOR ALL USING (user_id = auth.uid());

-- Action primitives are read-only for all authenticated users
CREATE POLICY "All users can read action primitives" ON action_primitives
  FOR SELECT USING (true);
```

### 5.2 Seed Data — System Templates

```sql
-- Seed system journey templates
INSERT INTO journey_templates (name, description, business_type, is_system, template_data) VALUES
(
  'Ecommerce Standard',
  'Standard online store funnel with product browsing, cart, and checkout',
  'ecommerce',
  true,
  '{
    "stages": [
      {"order": 1, "label": "Landing Page", "page_type": "landing", "actions": ["ad_landing"]},
      {"order": 2, "label": "Category Page", "page_type": "category", "actions": ["view_item_list"]},
      {"order": 3, "label": "Product Page", "page_type": "product", "actions": ["view_item", "add_to_cart"]},
      {"order": 4, "label": "Cart", "page_type": "cart", "actions": []},
      {"order": 5, "label": "Checkout", "page_type": "checkout", "actions": ["begin_checkout"]},
      {"order": 6, "label": "Purchase Confirmation", "page_type": "confirmation", "actions": ["purchase"]}
    ]
  }'
),
(
  'SaaS Standard',
  'Software product funnel from landing to sign-up and onboarding',
  'saas',
  true,
  '{
    "stages": [
      {"order": 1, "label": "Landing Page", "page_type": "landing", "actions": ["ad_landing"]},
      {"order": 2, "label": "Features", "page_type": "features", "actions": ["view_item"]},
      {"order": 3, "label": "Pricing", "page_type": "pricing", "actions": ["view_item"]},
      {"order": 4, "label": "Sign Up", "page_type": "sign_up", "actions": ["sign_up"]},
      {"order": 5, "label": "Onboarding Complete", "page_type": "confirmation", "actions": ["purchase"]}
    ]
  }'
),
(
  'Lead Generation Standard',
  'Service business funnel with form submission',
  'lead_gen',
  true,
  '{
    "stages": [
      {"order": 1, "label": "Landing Page", "page_type": "landing", "actions": ["ad_landing"]},
      {"order": 2, "label": "Service Pages", "page_type": "custom", "actions": ["view_item"]},
      {"order": 3, "label": "Contact Form", "page_type": "form", "actions": ["generate_lead"]},
      {"order": 4, "label": "Thank You Page", "page_type": "confirmation", "actions": []}
    ]
  }'
),
(
  'Content / Media',
  'Content site funnel with newsletter conversion',
  'content',
  true,
  '{
    "stages": [
      {"order": 1, "label": "Landing Page", "page_type": "landing", "actions": ["ad_landing"]},
      {"order": 2, "label": "Article Page", "page_type": "article", "actions": ["view_item"]},
      {"order": 3, "label": "Newsletter Signup", "page_type": "sign_up", "actions": ["sign_up"]},
      {"order": 4, "label": "Confirmation", "page_type": "confirmation", "actions": []}
    ]
  }'
),
(
  'Marketplace Standard',
  'Marketplace funnel from search to booking/purchase',
  'marketplace',
  true,
  '{
    "stages": [
      {"order": 1, "label": "Landing Page", "page_type": "landing", "actions": ["ad_landing"]},
      {"order": 2, "label": "Search Results", "page_type": "search_results", "actions": ["search", "view_item_list"]},
      {"order": 3, "label": "Listing Page", "page_type": "listing", "actions": ["view_item"]},
      {"order": 4, "label": "Enquiry / Booking", "page_type": "booking", "actions": ["begin_checkout", "generate_lead"]},
      {"order": 5, "label": "Confirmation", "page_type": "confirmation", "actions": ["purchase"]}
    ]
  }'
);

-- Seed action primitives table from the TypeScript definitions
-- (These should be seeded programmatically from ACTION_PRIMITIVES array on first deploy)
```

---

## 6. API Endpoints

### 6.1 Journey CRUD

```
POST   /api/journeys                           Create a new journey
GET    /api/journeys                           List user's journeys
GET    /api/journeys/:id                       Get journey with stages and platforms
PUT    /api/journeys/:id                       Update journey metadata
DELETE /api/journeys/:id                       Delete journey and all related data

POST   /api/journeys/:id/stages                Add a stage
PUT    /api/journeys/:id/stages/:stageId       Update a stage (label, URL, actions, order)
DELETE /api/journeys/:id/stages/:stageId       Remove a stage
PUT    /api/journeys/:id/stages/reorder        Reorder stages (accepts ordered array of stage IDs)

PUT    /api/journeys/:id/platforms             Set platform configuration (upsert all platforms at once)
```

### 6.2 Spec Generation

```
POST   /api/journeys/:id/generate              Generate specs (dataLayer + WalkerOS + validation spec)
GET    /api/journeys/:id/specs                  List generated specs for a journey
GET    /api/journeys/:id/specs/:format          Get specific spec (format: gtm_datalayer | walkeros_flow | validation_spec)
GET    /api/journeys/:id/specs/download         Download ZIP of all generated specs
```

### 6.3 Audit Integration

```
POST   /api/journeys/:id/audit                 Run audit using this journey's definition
GET    /api/journeys/:id/audit/:auditId        Get audit results with gap classification
GET    /api/journeys/:id/audit/:auditId/gaps    Get gaps only (filtered by stage, severity, type)
GET    /api/journeys/:id/audit/:auditId/report  Get/download the PDF report
```

### 6.4 Templates

```
GET    /api/templates                           List available templates (system + user's own + shared)
GET    /api/templates/:id                       Get template details
POST   /api/templates                           Save current journey as template
DELETE /api/templates/:id                       Delete user's own template
POST   /api/journeys/from-template/:templateId  Create a new journey from a template
```

### 6.5 Action Primitives (Read-Only Reference)

```
GET    /api/action-primitives                   List all action primitives with their platform mappings
GET    /api/action-primitives/:key              Get single primitive (e.g., /api/action-primitives/purchase)
```

---

## 7. Integration with Existing Atlas Systems

### 7.1 Browserbase Simulation Changes

The existing Browserbase simulator currently follows a hardcoded navigation path. It must be updated to:

1. Accept a `ValidationSpec` as input (generated by the Mapping Engine)
2. Navigate to the specific URLs defined in the journey stages (in order)
3. At each stage, wait for network idle and capture:
   - All dataLayer events
   - All network requests (filtered by platform endpoint patterns from the validation spec)
   - Browser cookies and localStorage
   - Console logs
4. Return per-stage capture data (not a single monolithic capture)

**Key change:** The simulator output must be structured as `StageCapture[]` (one per stage) rather than a flat list of all events. This enables the gap report to show results per stage.

```typescript
// File: src/simulation/stage-capture.ts

export interface StageCapture {
  stage_id: string;
  stage_order: number;
  stage_label: string;
  url_navigated: string;
  url_actual: string;               // May differ due to redirects
  navigation_success: boolean;
  load_time_ms: number;
  datalayer_events: DataLayerEvent[];
  network_requests: NetworkRequest[];
  cookies: CookieCapture[];
  local_storage: Record<string, string>;
  session_storage: Record<string, string>;
  console_logs: ConsoleLog[];
  errors: string[];
}
```

### 7.2 Validation Engine Changes

The existing 26-rule validation engine must be extended to:

1. Accept a `ValidationSpec` alongside the `StageCapture[]` data
2. Run the existing 26 rules as before (these are universal rules)
3. Run additional journey-specific checks:
   - For each stage: compare `expected_events` against `datalayer_events` in the capture
   - For each expected event: check that all `required_params` are present and non-empty
   - For each selected platform: check that a corresponding network request was observed
4. Classify results into the Gap Classification system (MISSING / WRONG / EXTRA)
5. Return results structured per-stage (for the Gap Report UI)

The existing 26 rules continue to run and their results are included in the overall score. The journey-specific checks add on top of them.

### 7.3 WalkerOS Validation Rules (New)

Per the WalkerOS Integration Strategy document, add these rules to the validation engine:

| Rule ID | Layer | Severity | What It Checks |
|---------|-------|----------|----------------|
| `WALKEROS_FLOW_INITIALIZED` | signal_initiation | critical | WalkerOS flow or walker.js is loaded on the page |
| `WALKEROS_SOURCES_CONFIGURED` | signal_initiation | high | WalkerOS sources are capturing events |
| `WALKEROS_DESTINATIONS_REACHABLE` | signal_initiation | high | Events are reaching configured WalkerOS destinations |
| `WALKEROS_CONSENT_WORKING` | parameter_completeness | medium | WalkerOS consent logic is functioning |
| `WALKEROS_MAPPING_TRANSFORMS_CORRECTLY` | parameter_completeness | medium | WalkerOS mapping rules produce correct field names for each destination |

These rules only run when the user's implementation format includes WalkerOS. They do not run for GTM-only setups.

### 7.4 Report Generator Changes

The existing 5-page PDF report generator must be enhanced:

**Page 2 (Journey Breakdown)** should now use the actual user-defined journey stages instead of a generic funnel. Show the user's custom stage labels, their status badges (green/amber/red/grey), and per-stage gap counts.

**Page 4 (Issues & Fixes)** should now group issues by journey stage first, then by platform. Each issue should show the gap type, business impact, fix suggestion, and the relevant code snippet from the generated spec.

Add a new optional page (Page 6): **Generated Tracking Spec** — a reference appendix showing the complete dataLayer or WalkerOS code that Atlas recommends. This is the same content as the downloadable spec, included in the PDF for convenience.

---

## 8. Frontend Components (React)

### 8.1 Component Hierarchy

```
<JourneyWizard>                           // Full-page wizard container
  <WizardProgress />                      // Step indicator (1 of 4, 2 of 4, etc.)
  <Step1BusinessType />                   // Card grid for business type selection
  <Step2JourneyEditor>                    // Funnel builder
    <StageCard />                         // Individual stage (label, URL, action toggles)
    <AddStageButton />                    // Insert between stages or at end
    <ActionToggles />                     // Expandable toggle list within StageCard
  </Step2JourneyEditor>
  <Step3PlatformSelector>                 // Platform checkboxes + format radio
    <PlatformCard />                      // Checkbox + optional ID field
    <FormatPicker />                      // GTM / WalkerOS / Both
  </Step3PlatformSelector>
  <Step4Review />                         // Summary + Generate button
</JourneyWizard>

<AuditProgress />                         // Progress screen during Browserbase sim

<GapReport>                               // Results page
  <ScoreCards />                          // 4 existing Atlas metrics
  <JourneyFunnelView />                   // Funnel with status badges
  <StageDetailPanel>                      // Slide-out or accordion per stage
    <GapCard />                           // Individual gap finding
  </StageDetailPanel>
  <ExportBar />                           // Download PDF, spec, JSON, share link
</GapReport>

<JourneyDashboard>                        // List of user's saved journeys
  <JourneyListItem />                     // Name, status, last audit score, actions
</JourneyDashboard>
```

### 8.2 State Management

Use React Context or Zustand for wizard state. The wizard state object:

```typescript
interface JourneyWizardState {
  // Step 1
  businessType: BusinessType | null;

  // Step 2
  stages: Stage[];

  // Step 3
  platforms: PlatformSelection[];
  implementationFormat: 'gtm' | 'walkeros' | 'both';

  // Navigation
  currentStep: 1 | 2 | 3 | 4;
  canProceed: boolean;               // Validation gate for Next button

  // Actions
  setBusinessType: (type: BusinessType) => void;
  addStage: (afterOrder: number) => void;
  removeStage: (stageId: string) => void;
  updateStage: (stageId: string, updates: Partial<Stage>) => void;
  reorderStages: (stageIds: string[]) => void;
  toggleAction: (stageId: string, actionKey: string) => void;
  togglePlatform: (platform: string) => void;
  setPlatformId: (platform: string, id: string) => void;
  setImplementationFormat: (format: string) => void;
}

interface Stage {
  id: string;                         // Client-side UUID
  order: number;
  label: string;
  pageType: string;
  sampleUrl: string;
  actions: string[];                  // Array of action primitive keys that are ON
}

interface PlatformSelection {
  platform: string;
  isActive: boolean;
  measurementId: string;
}
```

### 8.3 Drag and Drop

Use `@dnd-kit/core` for stage reordering. The StageCard component must:
- Show a drag handle on the left edge
- Support keyboard reordering for accessibility
- Animate position changes smoothly
- Update stage_order values on drop

---

## 9. Implementation Sequence

### Sprint 1 — Mapping Engine Foundation (Week 1–2)

**Goal:** Given a journey definition + platform selection, produce correct GTM and WalkerOS output.

| Task | Priority | Estimate |
|------|----------|----------|
| Create `action_primitives` table and seed with 8 actions | P0 | 2 hours |
| Implement `ActionPrimitive` TypeScript types and load from Supabase | P0 | 3 hours |
| Implement `PlatformSchema` definitions for GA4, Meta, Google Ads | P0 | 4 hours |
| Build GTM dataLayer output generator | P0 | 8 hours |
| Build WalkerOS flow.json output generator | P0 | 8 hours |
| Build validation spec generator | P0 | 4 hours |
| Add platform schemas for sGTM, TikTok, LinkedIn | P1 | 6 hours |
| Unit tests: verify generated output for all 8 actions × 6 platforms | P0 | 8 hours |
| Integration test: full journey → generated spec → verify correctness | P0 | 4 hours |

### Sprint 2 — Journey Builder UI (Week 3–4)

**Goal:** User can walk through the 4-step wizard and save a journey to Supabase.

| Task | Priority | Estimate |
|------|----------|----------|
| Build `JourneyWizard` container with step navigation | P0 | 4 hours |
| Build `Step1BusinessType` card grid | P0 | 3 hours |
| Build `Step2JourneyEditor` with `StageCard` components | P0 | 12 hours |
| Implement drag-and-drop reordering | P1 | 4 hours |
| Build `ActionToggles` expandable section within StageCard | P0 | 4 hours |
| Build `Step3PlatformSelector` with checkboxes and format picker | P0 | 4 hours |
| Build `Step4Review` summary screen | P0 | 3 hours |
| Journey CRUD API endpoints | P0 | 6 hours |
| Supabase table creation + RLS policies | P0 | 3 hours |
| Seed system templates | P0 | 2 hours |
| Connect wizard to Mapping Engine: generate specs on "Generate" click | P0 | 4 hours |
| Spec download (ZIP with dataLayer + flow.json files) | P0 | 3 hours |

### Sprint 3 — Gap Report + Audit Integration (Week 5–6)

**Goal:** Atlas runs journey-specific audits and shows a classified Gap Report.

| Task | Priority | Estimate |
|------|----------|----------|
| Refactor Browserbase simulator to accept `ValidationSpec` input | P0 | 8 hours |
| Refactor simulator output to `StageCapture[]` (per-stage) | P0 | 6 hours |
| Extend validation engine to run journey-specific checks | P0 | 8 hours |
| Implement gap classification logic (MISSING / WRONG / EXTRA) | P0 | 6 hours |
| Build `GapReport` page with funnel status view | P0 | 8 hours |
| Build `StageDetailPanel` with gap cards | P0 | 6 hours |
| Build `AuditProgress` screen with per-stage status | P1 | 3 hours |
| Connect audit results to journey_audit_results table | P0 | 4 hours |
| Add WalkerOS validation rules (5 new rules) | P1 | 6 hours |
| Update scoring engine to incorporate journey-specific gaps | P0 | 4 hours |

### Sprint 4 — Templates, Export, Polish (Week 7–8)

| Task | Priority | Estimate |
|------|----------|----------|
| Build template save/load system | P1 | 6 hours |
| Template management UI (list, save, delete) | P1 | 4 hours |
| Update PDF report generator with journey context | P0 | 8 hours |
| Add Page 6 (Generated Tracking Spec) to PDF | P1 | 4 hours |
| Share report link (generate shareable URL with 30-day expiry) | P2 | 4 hours |
| Journey dashboard (list saved journeys with last audit scores) | P1 | 6 hours |
| "Just Generate the Spec" flow (no audit, just code output) | P1 | 3 hours |
| Polish wizard UX: loading states, error handling, validation messages | P0 | 8 hours |
| End-to-end testing: wizard → spec generation → audit → gap report | P0 | 8 hours |
| Mobile responsiveness for wizard and gap report | P2 | 6 hours |

---

## 10. Edge Cases & Error Handling

### Wizard Edge Cases

| Scenario | Handling |
|----------|----------|
| User selects "Custom" in Step 1 | Show empty Step 2 with only an "Add Stage" button. Require at least 2 stages to proceed. |
| User removes all stages in Step 2 | Disable "Next" button. Show inline message: "Add at least 2 stages to continue." |
| User enables no action toggles across all stages | Disable "Next" button. Show: "Turn on at least one action (like 'People buy something here') so Atlas knows what to check." |
| User provides no URLs | Allow proceeding with a warning. "Just Generate the Spec" works. "Run Audit" shows stages as "Not Checked" (grey). |
| User provides invalid URLs | Validate URL format on blur. Show inline error if malformed. Don't block proceeding — the Browserbase sim will report navigation failure. |
| User provides URLs that require authentication | Browserbase will fail to load the page. Report as: "Could not access this page. It may require login. Atlas cannot currently audit pages that require authentication." |

### Audit Edge Cases

| Scenario | Handling |
|----------|----------|
| Browserbase times out on a stage | Mark stage as "Not Checked" with message: "This page took too long to load. Try running the audit again." |
| Page redirects to a different URL | Record both the intended URL and the actual URL. Continue the audit on the redirected page. Note the redirect in the gap report. |
| SPA navigation (no full page load between stages) | If consecutive stages are on the same domain, attempt SPA navigation using click simulation. If that fails, do a full page load for each stage URL. |
| WalkerOS not detected but user selected WalkerOS format | Skip WalkerOS-specific rules. Show info message: "WalkerOS was not detected on your site. The WalkerOS validation rules were skipped. The generated flow.json is still available for you to deploy." |
| Consent banner blocks tracking | Detect consent management platforms (OneTrust, Cookiebot, etc.). If consent blocks events, classify as "WRONG: consent_blocking" with severity Medium and note: "This may be intentional based on your consent settings." |

---

## 11. Success Metrics

| Metric | Target | How Measured |
|--------|--------|-------------|
| Wizard completion rate | >70% of users who start Step 1 complete Step 4 | Funnel analytics on wizard steps |
| Time to complete wizard | <3 minutes median | Timestamp difference between Step 1 load and Step 4 submit |
| Spec downloads per audit | >0.5 (at least half of users download the generated code) | Download event tracking |
| Gap report engagement | >80% of users click into at least one stage detail | Click tracking on stage cards |
| Return audit rate | >30% of users run a second audit within 14 days | Repeat audit tracking per user |
| Agency template usage | >50% of agency users create at least one custom template | Template creation tracking |

---

## 12. Out of Scope (for this version)

The following are explicitly excluded from this PRD and deferred to future versions:

- **Visual page scanner** — Auto-detecting pages and events by crawling the site (would complement the wizard but is a separate feature)
- **Real-time monitoring** — Continuous validation as events stream in (this is Phase 3 of the WalkerOS integration strategy, Atlas as a WalkerOS destination)
- **Multi-user collaboration** — Multiple team members editing the same journey simultaneously
- **Custom event definitions** — Allowing users to define entirely new event types beyond the 8 action primitives (the "Advanced" toggle per stage is a partial solution)
- **A/B testing of tracking implementations** — Comparing two different tracking setups
- **Consent simulation** — Testing what happens under different consent states (GDPR accept/reject scenarios)
- **API-only access** — Programmatic journey creation and auditing without the UI (deferred to v2.5 API tier)

---

## 13. Dependencies

| Dependency | Required For | Status |
|-----------|-------------|--------|
| Supabase (PostgreSQL + Auth) | All data storage, user management | Existing |
| Browserbase | Browser simulation for audits | Existing |
| React 19 + TypeScript | Frontend components | Existing |
| Node.js / Express | API endpoints | Existing |
| @dnd-kit/core | Drag-and-drop stage reordering | New dependency (npm install) |
| WalkerOS documentation | Correct flow.json schema and destination configs | Reference only |

---

## 14. Glossary

| Term | Definition |
|------|-----------|
| **Action Primitive** | A system-maintained business action (e.g., "purchase", "add_to_cart") that maps to platform-specific events and parameters |
| **Journey** | A user-defined sequence of funnel stages representing how customers move through their site |
| **Stage** | One step in a journey (e.g., "Product Page"), containing a label, optional URL, and enabled action toggles |
| **Mapping Engine** | The system that converts journey definitions into platform-specific technical specifications |
| **Gap** | A discrepancy between what the journey definition expects and what the audit actually found |
| **Gap Report** | The per-stage comparison of expected vs. actual signals, classified as MISSING or WRONG |
| **Validation Spec** | A JSON specification consumed by the Atlas audit engine, defining exactly what to check at each stage |
| **Platform Schema** | The definition of how a specific ad platform (GA4, Meta, etc.) expects events to be formatted and delivered |
| **Composable Tag** | A reusable event template that is defined once and works across stages, platforms, and clients |
