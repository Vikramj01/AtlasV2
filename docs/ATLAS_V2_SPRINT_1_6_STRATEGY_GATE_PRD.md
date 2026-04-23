# Atlas V2 — Sprint 1.6 PRD: Strategy Gate Redesign
**For:** Claude Code
**Repo:** `AtlasV2`
**Depends on:** Sprint 1 (language rewrite, mandatory Strategy Gate, `strategy_briefs` table from 20260420_001)
**Owner:** Vikram Jeet Singh
**Date:** 2026-04-20

---

## 1. Goal

The current Strategy Gate has three problems:

1. **It assumes a single conversion event.** Real businesses run multiple objectives (acquisition + retention + lead gen + wholesale). Forcing one event is wrong; letting them add many unstructured is worse.
2. **The wizard doesn't sell the purpose.** Users fill in fields without understanding why the Gate matters or what they'll get out of it.
3. **There's no output artefact.** The verdict exists only as a UI state. No document to share, revisit, or hand to a developer or client.

This sprint fixes all three, in three parts (1.6a → 1.6b → 1.6c). Parts must be built in the order listed because each depends on the previous.

## 2. In scope

- Multi-objective data model (replaces single-event model from Sprint 1)
- Strategy Gate wizard redesign (copy, teaching, per-objective evaluation)
- Strategy Brief output (PDF + web view + versioning)

## 3. Out of scope

- Tying the Strategy Brief's output into downstream site scan, tracking plan, or CAPI generation (that integration is explicitly deferred; the brief stands alone as a document for now, with a "use this for your site scan" CTA that is dismissible).
- Word/docx export of the brief (PDF only in V1).
- Collaborative editing or commenting on briefs.
- Objective templates / presets library.
- Any change to existing site scan, tracking plan, or CAPI surfaces.

## 4. Sequencing

| Part | Scope | Estimate |
|---|---|---|
| 1.6a | Multi-objective data foundation | 3 days |
| 1.6b | Wizard redesign on top of 1.6a | 4 days |
| 1.6c | Strategy Brief output (PDF + web view) | 3 days |

Total: ~2 weeks. 1.6c can start as soon as 1.6a's data model lands; it does not need 1.6b's wizard changes to proceed.

---

# Part 1.6a — Multi-objective data foundation

## 1.6a.1 Why first

Every downstream piece (wizard, brief output, future tracking plan scoping) reads from this data model. Getting the shape right now avoids a painful migration later.

## 1.6a.2 Schema changes

**File:** `supabase/migrations/20260420_003_strategy_objectives.sql`

```sql
-- Extend strategy_briefs to support the multi-objective model.
-- The original single-event columns become the 'default objective' for existing rows.

ALTER TABLE strategy_briefs
  ADD COLUMN mode TEXT NOT NULL DEFAULT 'single'
    CHECK (mode IN ('single','multiple')),
  ADD COLUMN brief_name TEXT,
  ADD COLUMN version_no INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN locked_at TIMESTAMPTZ,
  ADD COLUMN superseded_by UUID REFERENCES strategy_briefs(id);

CREATE TABLE strategy_objectives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id UUID NOT NULL REFERENCES strategy_briefs(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 1,
  business_outcome TEXT NOT NULL,
  outcome_timing_days INTEGER NOT NULL,
  current_event TEXT,
  platforms TEXT[] NOT NULL DEFAULT '{}',
  verdict TEXT CHECK (verdict IN ('keep','add_proxy','switch')),
  recommended_primary_event TEXT,
  recommended_proxy_event TEXT,
  rationale TEXT,
  warnings TEXT[] DEFAULT '{}',
  locked BOOLEAN NOT NULL DEFAULT FALSE,
  locked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE strategy_objectives ENABLE ROW LEVEL SECURITY;
CREATE POLICY strategy_objectives_org ON strategy_objectives
  USING (organization_id IN (
    SELECT organization_id FROM profiles WHERE id = auth.uid()
  ));

CREATE TABLE strategy_objective_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  objective_id UUID NOT NULL REFERENCES strategy_objectives(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('meta','google','linkedin','tiktok','other')),
  campaign_identifier TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE strategy_objective_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY strategy_objective_campaigns_org ON strategy_objective_campaigns
  USING (organization_id IN (
    SELECT organization_id FROM profiles WHERE id = auth.uid()
  ));

CREATE INDEX idx_strategy_objectives_brief ON strategy_objectives(brief_id);
CREATE INDEX idx_strategy_objective_campaigns_objective ON strategy_objective_campaigns(objective_id);
```

**Data migration rule:** for existing `strategy_briefs` rows created in Sprint 1 (single-event mode), create one `strategy_objectives` row per brief with:
- `name = 'Primary objective'`
- copy `business_outcome`, `outcome_timing_days`, `current_event`, `verdict`, proxy event, rationale from the brief
- `locked = true`, `locked_at = brief.created_at`

Do this in the same migration with an `INSERT ... SELECT` after the columns are added. After the migration verifies successfully, the single-event columns on `strategy_briefs` can be deprecated (keep them for one release, then drop in a later migration — do not drop in this sprint).

## 1.6a.3 Guardrails

- Soft cap: warn when an organisation creates more than 5 objectives on one brief. Copy: *"Most projects need 3 or fewer distinct objectives. Consider whether some of these overlap, or whether you need multiple Atlas projects."*
- Hard cap: reject the 11th objective with 400 error. Copy: *"Create a new Atlas project for additional objectives."*
- No duplicate-name objectives within one brief (case-insensitive).
- `platforms` array allows multiple but must be from the enum.

## 1.6a.4 API changes

**File:** `backend/src/api/routes/strategy.ts` (extend existing)

New endpoints:

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/strategy/briefs` | Create brief (empty, with mode='single' or 'multiple') |
| GET | `/api/strategy/briefs/:id` | Fetch brief + all objectives + campaigns |
| PATCH | `/api/strategy/briefs/:id` | Update brief-level fields (name, mode) |
| POST | `/api/strategy/briefs/:id/objectives` | Add objective to brief |
| PATCH | `/api/strategy/objectives/:id` | Update objective inputs (not verdict fields) |
| DELETE | `/api/strategy/objectives/:id` | Remove objective (only if brief not fully locked) |
| POST | `/api/strategy/objectives/:id/evaluate` | Run Claude evaluation on one objective — this replaces the current `/api/strategy/evaluate` endpoint scope |
| POST | `/api/strategy/objectives/:id/lock` | Mark this objective as locked |
| POST | `/api/strategy/briefs/:id/lock` | Lock the whole brief — all objectives must be individually locked first |
| POST | `/api/strategy/objectives/:id/campaigns` | Add campaign assignment |
| DELETE | `/api/strategy/campaigns/:id` | Remove campaign assignment |

Keep the old `POST /api/strategy/evaluate` endpoint for one release as a thin wrapper that creates a brief + one objective + evaluates it. Deprecate in release notes.

All endpoints:
- `authMiddleware` required
- `planGuard('free')` (Strategy Gate on all plans per Sprint 1 rule)
- `heavyLimiter` on the two Claude-calling endpoints (`evaluate` endpoints)
- Zod validation on all bodies
- Standard `{ data, error, message }` response shape

## 1.6a.5 Types

**File:** `frontend/src/types/strategy.ts` — extend with:

```ts
export type ObjectivePlatform = 'meta' | 'google' | 'linkedin' | 'tiktok' | 'other';
export type ObjectiveVerdict = 'keep' | 'add_proxy' | 'switch';

export interface StrategyObjective {
  id: string;
  brief_id: string;
  name: string;
  priority: number;
  business_outcome: string;
  outcome_timing_days: number;
  current_event: string | null;
  platforms: ObjectivePlatform[];
  verdict: ObjectiveVerdict | null;
  recommended_primary_event: string | null;
  recommended_proxy_event: string | null;
  rationale: string | null;
  warnings: string[];
  locked: boolean;
  locked_at: string | null;
  campaigns: ObjectiveCampaign[];
  created_at: string;
  updated_at: string;
}

export interface ObjectiveCampaign {
  id: string;
  objective_id: string;
  platform: ObjectivePlatform;
  campaign_identifier: string | null;
  notes: string | null;
  created_at: string;
}

export interface StrategyBrief {
  id: string;
  organization_id: string;
  client_id: string | null;
  project_id: string | null;
  business_type: string;
  mode: 'single' | 'multiple';
  brief_name: string | null;
  version_no: number;
  objectives: StrategyObjective[];
  locked_at: string | null;
  superseded_by: string | null;
  created_at: string;
}
```

## 1.6a.6 Store changes

**File:** `frontend/src/store/strategyStore.ts` (new or extend)

Zustand store managing:
- Current brief draft in flight (pre-lock)
- Selected objective being edited
- Evaluation loading state per objective
- Lock state per objective + overall brief

## 1.6a.7 Acceptance — 1.6a

- Migration applies cleanly on a database with Sprint 1's single-event briefs.
- All single-event briefs from Sprint 1 have a corresponding `strategy_objectives` row after migration.
- The 11 new endpoints return correct shapes and respect RLS.
- Creating 11 objectives on one brief returns a 400 error.
- Creating 6 objectives shows the soft warning via a flag on the response.
- Zod rejects malformed input.
- Contract test asserts every endpoint round-trips correctly.

---

# Part 1.6b — Wizard redesign

## 1.6b.1 Why second

The new wizard reads and writes to the data model from 1.6a. Without 1.6a, the wizard has nowhere to store multiple objectives. With 1.6a in place, the wizard is pure frontend work plus one updated Claude prompt on the evaluation endpoint.

## 1.6b.2 New user flow

```
Landing page
  ↓
  Teaches what the Strategy Gate is and why it matters
  ↓
  "One objective or multiple?" toggle (default: One)
  ↓
  ─── Single path ───                    ─── Multiple path ───
  Straight to wizard                     Objectives list view
  ↓                                      ↓
  Complete 2-step wizard                 Add objective → wizard per objective
  ↓                                      ↓
  Verdict page                           Back to list, see status per objective
  ↓                                      ↓
  Lock objective                         Repeat until all locked
  ↓                                      ↓
  → (single case: brief auto-locks)      Lock brief
                                         ↓
  (Both paths converge)
  ↓
  Brief locked screen with download + next steps
```

## 1.6b.3 Landing page redesign

**File:** `frontend/src/pages/StrategyPage.tsx`

Replace the current Step-1-of-2 page with a proper landing page. Contents:

### Header section
- Heading: **"Lock your conversion strategy"**
- Subline: *"Your ad platforms optimise toward whatever conversion event you send them. If that event isn't tied to real business success, Meta and Google will find you more of the wrong customers — faster. A few minutes here protects every ad dollar you spend after this."*

### Value preview strip (three tiles, icon + one-line each)
1. **Verdict per objective** — "Keep current event, add a proxy, or switch entirely"
2. **Locked strategy document** — "A branded PDF you can share with your team or client"
3. **Foundation for everything next** — "Site scan, tracking plan, and CAPI events will all follow this strategy"

### Mode toggle
Label: **"Does this business have one objective or multiple?"**

Two options, stacked radio cards (not a dropdown):
- **One objective** (default, selected by default) — "Most small businesses. One product, one funnel, one conversion to optimise."
- **Multiple objectives** — "Multiple distinct outcomes — e.g. D2C sales plus wholesale leads, or acquisition plus retention."

Small text under both: *"You can change this later."*

### Primary CTA
Button: **"Start"**
- Single mode → goes to the wizard (1.6b.4)
- Multiple mode → goes to the objectives list (1.6b.5)

## 1.6b.4 The wizard (shared between single and multiple paths)

The wizard exists per objective. In single mode it's the only thing the user touches; in multiple mode it opens for each added objective.

### Step 1: Define the objective

**File:** `frontend/src/components/strategy/Step1Define.tsx` (replaces Step1Outcome)

Fields:

1. **Objective name** *(only shown in multiple mode)*
   - Placeholder: "e.g. New customer acquisition"
   - 3–50 characters
   - Helper: *"A short label to tell this objective apart from others."*

2. **Business type** (dropdown, existing)
   - Unchanged from current implementation

3. **Business outcome** (textarea)
   - Heading: **"What does a genuinely successful customer look like?"**
   - Helper: *"Not the event you track — the real business result. A successful customer might be one who makes a second purchase, renews a subscription, or books a qualified sales call."*
   - Below the field, a collapsible **"See examples"** link with:
     - **SaaS:** "Customer pays their second monthly subscription without cancelling."
     - **Ecommerce:** "Customer makes a second purchase within 60 days."
     - **Lead gen:** "Lead books a qualified sales call and shows up."
     - **Publisher:** "Subscriber opens 3+ emails in first 30 days."
     - **Wholesale:** "Buyer places a first bulk order after quote."
   - Min 30 characters (keep existing validation).

4. **Outcome timing** (dropdown, existing)
   - Unchanged

5. **Current conversion event** (text input — NEW, moves from Step 2)
   - Heading: **"What event are you optimising your ads toward today?"**
   - Helper: *"The event name you send to Meta, Google Ads, or your CAPI. Examples: Purchase, Sign Up, Lead, Quote Request."*
   - Optional — user can mark "Not sure" or "Nothing yet" — those cases produce a different verdict path.

6. **Ad platforms** (multi-select chips — NEW)
   - Options: Meta, Google Ads, LinkedIn, TikTok, Other
   - Helper: *"Which platforms are you spending on for this objective? Select all that apply."*
   - Affects verdict framing (e.g. Meta constraints differ from Google).

CTA: **"Evaluate my conversion strategy →"** (renamed from "Continue to event check")

### Step 2: The verdict page

**File:** `frontend/src/components/strategy/Step2Verdict.tsx` (replaces Step2EventEval and StrategyBrief display)

Shows Claude's evaluation of the inputs. Layout:

```
┌──────────────────────────────────────────────────────────────┐
│  Your objective: New customer acquisition                    │
│                                                              │
│  Outcome:  Customer renews monthly past month 2              │
│  Current:  Sign Up                                           │
│  Timing:   60 days                                           │
│  Platforms: Meta, Google                                     │
├──────────────────────────────────────────────────────────────┤
│  Verdict                                                     │
│                                                              │
│  ⚠  ADD PROXY EVENT                                          │
│                                                              │
│  Sign Up fires 60 days before your real outcome. Meta and    │
│  Google can't optimise on a 60-day feedback loop. You need   │
│  a proxy event that fires sooner AND correlates with         │
│  renewals.                                                   │
│                                                              │
│  Recommended primary event:  Sign Up                         │
│  Recommended proxy event:    Activation                      │
│    (user completes onboarding + first meaningful action)     │
│                                                              │
│  Why: Users who activate within 7 days renew at 3–4x the     │
│  rate of those who don't. Activation fires in 1–7 days,      │
│  giving ad platforms a tight feedback loop that still        │
│  correlates with the real outcome.                           │
│                                                              │
│  Warnings:                                                   │
│  • Don't remove Sign Up entirely — keep it as secondary      │
│  • Meta only optimises toward one primary event per ad set   │
├──────────────────────────────────────────────────────────────┤
│  [ Lock this objective ]    [ Ask a follow-up question ]     │
│  [ Edit inputs ]                                             │
└──────────────────────────────────────────────────────────────┘
```

Verdict card colour by verdict type:
- **Keep** → green accent
- **Add proxy** → amber accent
- **Switch** → red accent

"Ask a follow-up question" opens a textarea and re-calls Claude with the verdict as context — adds a second paragraph to `rationale` rather than replacing it. Stretch goal — can be deferred to backlog if time-constrained.

"Edit inputs" → back to Step 1, preserves field values.

"Lock this objective" → calls `POST /api/strategy/objectives/:id/lock`, transitions state:
- Single mode: transitions to brief-locked screen (1.6b.6)
- Multiple mode: returns to objectives list (1.6b.5)

## 1.6b.5 Objectives list (multiple mode only)

**File:** `frontend/src/components/strategy/ObjectivesList.tsx`

Shown when `mode === 'multiple'`. Contents:

```
Your objectives (2 of 5 recommended)               [+ Add objective]

┌──────────────────────────────────────────────────────────┐
│ 1. New customer acquisition                              │
│    ✓ Locked · Verdict: Add proxy · 2 platforms           │
│                                       [View] [Edit]      │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│ 2. Wholesale lead generation                             │
│    ⚠ Needs evaluation                                    │
│                                       [Continue →]       │
└──────────────────────────────────────────────────────────┘

[ Lock brief ]  ← disabled until all objectives locked
```

Rules:
- "Add objective" opens a fresh wizard (Step 1 → Step 2)
- Soft warning shows when 6th objective is added
- 11th objective add blocked with 400 (per 1.6a rules)
- Objectives can be reordered by dragging (priority field)
- Each objective shows verdict pill (Keep/Add proxy/Switch) in its own colour
- "Lock brief" only enables when every objective is locked
- Minimum 1 locked objective required to lock the brief

## 1.6b.6 Brief-locked screen

**File:** `frontend/src/components/strategy/BriefLocked.tsx`

Shown after brief-level lock succeeds. Contents:

### Success header
- Heading: **"Your conversion strategy is locked"**
- Subline: *"Your Strategy Brief is ready. Share it with your team, hand it to a developer, or keep it for reference."*

### Primary action
- Large card with PDF icon
- Title: **"Download Strategy Brief"**
- Subline: *"A branded PDF covering all objectives, verdicts, and implementation notes."*
- Button: **"Download PDF"** (triggers 1.6c PDF generation)
- Secondary link: **"View in Atlas"** (goes to web view, 1.6c)

### Next steps strip (dismissible)
Three cards, each with CTA to the relevant next step:
1. **Run a site scan** → "See how your current tracking matches this strategy." CTA → `/planning`
2. **Configure CAPI** → "Send your locked events server-side to Meta and Google." CTA → `/capi`
3. **Set up consent** → "Make sure this all works under Consent Mode v2." CTA → `/consent`

Strip is dismissible (`localStorage`); after dismissal the page just shows the download card.

## 1.6b.7 Claude prompt update

**File:** `backend/src/services/strategy/evaluationPrompt.ts` (new or extend existing)

The `POST /api/strategy/objectives/:id/evaluate` endpoint calls Claude with a system prompt that must produce a structured response:

```json
{
  "verdict": "keep" | "add_proxy" | "switch",
  "recommended_primary_event": "string",
  "recommended_proxy_event": "string | null",
  "rationale": "string (2–4 sentences, plain English)",
  "warnings": ["string", ...]
}
```

System prompt anchors:
- Teach Claude the three verdict types and when each applies
- Require proxy event when `outcome_timing_days > 1` AND `current_event` fires earlier than outcome (reflects Sprint 1 rule, keep it)
- Warn about platform-specific constraints (Meta: one primary per ad set; Google: Primary + Secondary allowed)
- Must address all provided platforms in the rationale
- Plain English only — no engineer jargon

Response parsed, validated with Zod, persisted to `strategy_objectives` verdict fields.

## 1.6b.8 Acceptance — 1.6b

- Landing page teaches purpose and shows value preview before any form field.
- Toggle defaults to single mode.
- Step 1 captures all six fields (name conditional on mode).
- Examples accordion on business outcome works.
- Step 2 verdict page renders with correct colour accents per verdict type.
- Multiple mode list view works: add, edit, reorder, lock per objective.
- Soft warning appears on 6th objective, hard error on 11th.
- Brief-locked screen presents PDF download and dismissible next-steps strip.
- End-to-end: single-mode user can complete the flow in under 3 minutes with one objective.
- End-to-end: multi-mode user can complete two objectives and lock the brief.

---

# Part 1.6c — Strategy Brief output

## 1.6c.1 Why last

Both the PDF generator and web view read from the locked data in 1.6a. They render whatever exists regardless of whether 1.6b's new wizard has created it. Build 1.6c in parallel with 1.6b once 1.6a is done — use the migrated existing single-event briefs as the first test data.

## 1.6c.2 PDF generator

**File:** `backend/src/services/strategy/briefPdfGenerator.ts`

Stack: reuse existing PDF tooling used for audit reports. If none exists with the required fidelity, use `pdfkit` or `puppeteer` with an HTML template — puppeteer is preferred because the brief is design-heavy.

### Template sections (in order)

1. **Cover**
   - Atlas wordmark top-left (consistent with app header treatment from Sprint 1.5)
   - "Conversion Strategy Brief" as h1
   - Client name (from `clients` table via `brief.client_id` if set, else organisation name)
   - Date locked
   - Version number (`v1`, `v2`…)
   - Brief name (if set)

2. **Summary**
   - Business type
   - Number of objectives
   - One-line summary per objective: `Name — Verdict`
   - Example: *"New customer acquisition — Add proxy event (Activation)"*

3. **Per objective** (one block per objective, page break between)
   - Objective name as h2
   - Inputs table: Business outcome · Outcome timing · Current event · Platforms
   - Verdict block (coloured):
     - Verdict label
     - Recommended primary event
     - Recommended proxy event (if any)
     - Rationale paragraph(s)
     - Warnings list (if any)
   - Campaign assignments (if captured): bulleted list grouped by platform

4. **Implementation notes** (generated section)
   - For each objective, produce plain-English implementation guidance derived from the verdict:
     - "In Meta Ads Manager, set **{recommended_primary_event}** as the primary conversion event."
     - "If using a proxy, configure **{recommended_proxy_event}** to fire when {plain-English trigger}."
     - "Keep **{current_event}** as a secondary conversion — don't remove it."
     - Platform-specific notes per platform in `objective.platforms`
   - Derived by a simple template function in `briefPdfGenerator.ts` — no Claude call at PDF generation time (rationale is already in the objective; implementation guidance is rule-based templating)

5. **What happens next in Atlas**
   - Short paragraph: *"Atlas uses this strategy as the foundation for site scans, tracking plan generation, and Conversion API setup. When you're ready, run a site scan from the Atlas dashboard to see how your current tracking matches what's locked here."*
   - Three bullet links (rendered as text in PDF; live hyperlinks in HTML view):
     - Run a site scan
     - Configure Conversion API
     - Set up Consent Mode v2

6. **Appendix**
   - Full raw inputs (business outcome textarea content, platform selections, timestamps)
   - "Generated by Atlas · {timestamp} · Version {N}"
   - Organisation name

### File naming

`Atlas-Strategy-Brief-{clientOrOrgSlug}-v{N}-{YYYY-MM-DD}.pdf`

### Branding

- Atlas navy/cyan palette consistent with app theme
- Clean typography, generous whitespace
- No emoji in PDF body
- Verdict accents use the same three colours as the verdict page (green/amber/red)

## 1.6c.3 PDF endpoint

**File:** `backend/src/api/routes/strategy.ts` (extend)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/strategy/briefs/:id/export/pdf` | Trigger PDF generation, return PDF as binary or signed URL |

Rules:
- `authMiddleware` required
- `planGuard('free')` (Strategy Brief download available on all plans)
- Brief must be locked (400 if not)
- Rate limit: 10 requests per hour per user (avoid accidental mass generation)
- Response: either stream the PDF directly or upload to Supabase Storage and return a signed URL expiring in 1 hour — prefer signed URL so the frontend can show the download link to the user and reuse it

Filenames set in response `Content-Disposition` for direct-stream case.

## 1.6c.4 Versioning

Any change to the brief after lock creates a new version:
- Editing a locked objective's inputs → "This will create version N+1" confirmation modal
- On confirm: current brief's `superseded_by` is set to a new brief row cloned with `version_no + 1`; objectives cloned as editable copies (reset `locked = false`)
- Previous version remains readable and downloadable

Web view (1.6c.5) has a version picker for briefs where `superseded_by` chain has entries.

## 1.6c.5 Web view inside Atlas

**File:** `frontend/src/pages/StrategyBriefPage.tsx`

Route: `/strategy/briefs/:id`

Same content as the PDF, rendered as a web page. Sections collapse/expand. Top of page has:
- Breadcrumb: Strategy → Briefs → {Brief name}
- Version picker if multiple versions exist
- Actions: Download PDF · Edit (creates new version) · View earlier version

This becomes the canonical persistent home of the brief after it's locked.

## 1.6c.6 Where briefs are accessible from

- Home Next Action card (when a brief is freshly locked, briefly shows "Download your Strategy Brief" for 7 days)
- Settings → Strategy Briefs (new sub-page) listing all briefs for the org
- Client detail page (if brief is tied to a client) — brief appears in the client's document list
- Direct URL via `/strategy/briefs/:id`

## 1.6c.7 Storage

PDFs stored in Supabase Storage bucket `strategy-briefs/` with path:
```
{organization_id}/{brief_id}/v{version_no}.pdf
```

RLS on the storage bucket scoped by `organization_id`. Signed URLs for downloads.

Regeneration: if the user downloads after schema changes that affect PDF layout, regenerate rather than serve stale. Hash of brief + objectives + template version stored alongside the PDF; mismatch triggers regen.

## 1.6c.8 Acceptance — 1.6c

- Locking a brief enables PDF download within 5 seconds of the user clicking the button.
- PDF renders all sections cleanly on A4 and Letter page sizes.
- Multi-objective briefs page-break between objectives.
- File naming format matches spec.
- Versioning: editing a locked brief creates v2, v1 remains downloadable.
- Signed URLs expire after 1 hour and cannot be accessed cross-organisation.
- Web view at `/strategy/briefs/:id` renders the same content as the PDF.
- Dismissible next-steps strip on the brief-locked screen in 1.6b.6 hands off to this output cleanly.

---

## 5. Cross-cutting rules (all three parts)

1. Follows Sprint 1 language rewrite — no engineer jargon anywhere user-visible.
2. Zod validation on every new route.
3. Error boundary wraps every new page.
4. Zustand for state; no React Query.
5. `{ data, error, message }` response shape on every endpoint.
6. RLS enforced on all new tables via `organization_id`.
7. Claude API calls backend-only. API key never exposed.
8. Super admin bypasses plan gates on these routes (consistent with existing rules).

## 6. Migrations summary

```
20260420_003_strategy_objectives.sql       — 1.6a: objectives + campaigns tables + brief columns
```

## 7. Definition of done

- All three parts merged to `main`.
- Existing Sprint 1 single-event briefs migrated to the multi-objective model with no data loss.
- Fresh user can complete the Strategy Gate in single mode in under 3 minutes and download a PDF brief.
- Power user (agency running multi-brand) can complete multi-objective mode with 3 objectives and produce one combined PDF brief.
- PDF brief is clean enough to hand to a client without embarrassment — manual QA by Vikram before shipping.
- Web view and PDF show identical content.
- Versioning works: edit a locked brief, v2 is created, v1 remains readable.

---

**End of PRD.**
