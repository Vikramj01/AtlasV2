# ATLAS Signal Integrity Auditor

## Project Overview

**Atlas** is a marketing-facing Signal Health Platform that audits conversion tracking infrastructure on SPAs and headless commerce sites. It simulates user journeys using Browserbase, validates signal integrity across 26 rules, scores conversion health, and produces executive-ready reports that non-technical marketers can understand and act on.

**Target Users:** Growth marketers, agencies, marketing ops teams
**Tech Stack:** React 19 + TypeScript + Node.js/Express + Supabase + Browserbase
**Timeline:** 3 x 30-day sprints (90 days to MVP)
**Status:** Ready for implementation (all specs, rules, and designs complete)

---

## Quick Start

### What You're Building

A conversion signal auditor that:
1. **Scans** a website's conversion funnel (using Browserbase headless browser)
2. **Validates** tracking signals across 26 rules (3 validation layers)
3. **Scores** signal health (4 metrics: Conversion Signal Health, Attribution Risk, Optimization Strength, Data Consistency)
4. **Translates** technical failures into business impact statements
5. **Reports** findings in a 5-page marketing-friendly format (PDF + JSON export)

### Key Deliverables

✅ **Complete validation rules** (`validation-rules.ts`, 26 rules ready to code)
✅ **Business interpretation mappings** (`rule-interpretations.ts`, tech → marketing translation)
✅ **90-day sprint roadmap** (3 sprints, task-by-task breakdown)
✅ **Frontend & backend architecture** (file structure, database schema, API contracts)
✅ **Implementation guide** (detailed for Claude Code)

---

## Architecture Overview

### Frontend (React 19 + TypeScript)
- **Audit Setup Page** — User enters URL + funnel type
- **Audit Progress** — Real-time polling status
- **5-Page Report Layout:**
  1. Executive Summary (status + 4 core metrics)
  2. Journey Breakdown (visual funnel with pass/fail per stage)
  3. Platform Impact (Google Ads, Meta, GA4, sGTM sections)
  4. Issues & Fixes (actionable problems with business impact)
  5. Technical Details (expandable, hidden by default)
- **Export Controls** — PDF + JSON download

### Backend (Node.js/Express)
- **Audit Orchestrator** — Job management
- **Browserbase Integration** — Headless browser automation
- **Validation Engine** — Run 26 rules against captured data
- **Scoring Engine** — Calculate 4 scores
- **Interpretation Engine** — Map technical → business impact
- **Report Generator** — Produce marketing-friendly JSON
- **Database Layer** — Supabase PostgreSQL

### External Services
- **Browserbase** — Managed Playwright ($0.30/min)
- **Supabase** — Database + Auth

### Database (Supabase PostgreSQL)
- `audits` — Audit metadata
- `audit_results` — Validation results per rule
- `audit_reports` — Final marketing-friendly report JSON

---

## File Structure

### Frontend
```
src/
├── components/
│   ├── audit/
│   │   ├── AuditSetup.tsx              [NEW]
│   │   ├── AuditProgress.tsx           [NEW]
│   │   ├── AuditReport.tsx             [NEW]
│   │   └── ReportPages/                [NEW]
│   │       ├── ExecutiveSummary.tsx
│   │       ├── JourneyBreakdown.tsx
│   │       ├── PlatformImpact.tsx
│   │       ├── IssuesAndFixes.tsx
│   │       └── TechnicalDetails.tsx
│   ├── common/
│   │   ├── StatusBadge.tsx             [KEEP]
│   │   ├── MetricCard.tsx              [EXTEND]
│   │   └── ExportButton.tsx            [NEW]
│   └── layout/
│       └── Navigation.tsx              [REDESIGN]
├── hooks/
│   ├── useAudit.ts                     [NEW]
│   └── useReport.ts                    [NEW]
├── lib/
│   ├── api/auditApi.ts                 [NEW]
│   └── utils/reportTransform.ts        [NEW]
├── pages/
│   ├── AuditPage.tsx                   [NEW]
│   ├── ReportPage.tsx                  [NEW]
│   └── DashboardPage.tsx               [DELETE]
├── store/
│   └── auditStore.ts                   [NEW] (Zustand)
├── types/
│   └── audit.ts                        [NEW]
└── App.tsx                             [REDESIGN]
```

### Backend
```
src/
├── api/
│   ├── routes/audits.ts                [NEW]
│   └── middleware/
│       ├── authMiddleware.ts           [KEEP]
│       └── auditLimiter.ts             [NEW]
├── services/
│   ├── browserbase/
│   │   ├── client.ts                   [NEW]
│   │   ├── journeyConfigs.ts           [NEW]
│   │   └── types.ts                    [NEW]
│   ├── audit/
│   │   ├── orchestrator.ts             [NEW]
│   │   ├── journeySimulator.ts         [NEW]
│   │   └── dataCapture.ts              [NEW]
│   ├── validation/
│   │   ├── engine.ts                   [NEW]
│   │   ├── signalInitiation.ts         [NEW]
│   │   ├── parameterCompleteness.ts    [NEW]
│   │   ├── persistence.ts              [NEW]
│   │   └── types.ts                    [NEW]
│   ├── scoring/
│   │   ├── engine.ts                   [NEW]
│   │   └── types.ts                    [NEW]
│   ├── interpretation/
│   │   ├── engine.ts                   [NEW]
│   │   ├── ruleMap.ts                  [NEW] (or import from rule-interpretations.ts)
│   │   └── types.ts                    [NEW]
│   ├── reporting/
│   │   ├── generator.ts                [NEW]
│   │   ├── exportHandler.ts            [NEW]
│   │   └── types.ts                    [NEW]
│   ├── database/
│   │   ├── supabase.ts                 [NEW]
│   │   └── queries.ts                  [NEW]
│   └── queue/
│       └── jobQueue.ts                 [NEW]
├── db/
│   ├── migrations/
│   │   └── 001_create_audit_tables.sql [NEW]
│   └── schema.sql                      [NEW]
├── types/
│   ├── audit.ts                        [NEW]
│   └── api.ts                          [NEW]
├── utils/
│   ├── logger.ts                       [NEW]
│   └── error.ts                        [NEW]
├── config/
│   └── env.ts                          [NEW]
├── app.ts                              [CREATE]
├── server.ts                           [CREATE]
└── index.ts                            [CREATE]
```

---

## Validation Rules (26 Total)

All rules are implemented in `validation-rules.ts` and ready to code.

### Layer 1: Signal Initiation (8 Rules)
Are conversion events firing at all?
- GA4_PURCHASE_EVENT_FIRED
- META_PIXEL_PURCHASE_EVENT_FIRED
- GOOGLE_ADS_CONVERSION_EVENT_FIRED
- SGTM_SERVER_EVENT_FIRED
- DATALAYER_POPULATED
- GTM_CONTAINER_LOADED
- PAGE_VIEW_EVENT_FIRED
- ADD_TO_CART_EVENT_FIRED

### Layer 2: Parameter Completeness (12 Rules)
Are required parameters present?
- TRANSACTION_ID_PRESENT
- VALUE_PARAMETER_PRESENT
- CURRENCY_PARAMETER_PRESENT
- GCLID_CAPTURED_AT_LANDING
- FBCLID_CAPTURED_AT_LANDING
- EVENT_ID_GENERATED
- EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS
- PHONE_CAPTURED_FOR_CAPI
- ITEMS_ARRAY_POPULATED
- USER_ID_PRESENT
- COUPON_CAPTURED_IF_USED
- SHIPPING_CAPTURED

### Layer 3: Persistence (6 Rules)
Do identifiers survive cross-page navigation?
- GCLID_PERSISTS_TO_CONVERSION
- FBCLID_PERSISTS_TO_CONVERSION
- TRANSACTION_ID_MATCHES_ORDER_SYSTEM
- EVENT_ID_CONSISTENCY_CLIENT_TO_SERVER
- USER_DATA_NORMALIZED_CONSISTENTLY
- PII_PROPERLY_HASHED

---

## API Endpoints

### POST /api/audits/start
Start a new audit (async, returns immediately)
```typescript
Request: {
  website_url: string;
  funnel_type: "ecommerce" | "saas" | "lead_gen";
  region?: "us" | "eu" | "global";
  test_email?: string;
  test_phone?: string;
}

Response: {
  audit_id: string;
  status: "queued";
  created_at: string;
}
```

### GET /api/audits/:audit_id
Poll audit status
```typescript
Response: {
  audit_id: string;
  status: "running" | "completed" | "failed";
  created_at: string;
  completed_at?: string;
  progress?: number;
  error?: string;
}
```

### GET /api/audits/:audit_id/report
Fetch final report (only after completed)
```typescript
Response: {
  audit_id: string;
  executive_summary: { overall_status, business_summary };
  scores: { conversion_signal_health, attribution_risk_level, optimization_strength, data_consistency_score };
  journey_stages: Array<{ stage, status, details }>;
  platform_breakdown: Array<{ platform, status, risk_explanation }>;
  issues: Array<{ rule_id, problem, why_matters, recommended_owner, fix_summary, estimated_effort }>;
  technical_appendix: { raw_payloads, validation_results };
}
```

### POST /api/audits/:audit_id/export
Export audit as PDF + JSON
```typescript
Request: { format: "pdf" | "json" | "both" }

Response: File download (Content-Disposition: attachment)
```

---

## Database Schema

### audits table
```sql
CREATE TABLE audits (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  website_url TEXT NOT NULL,
  funnel_type TEXT NOT NULL,
  region TEXT DEFAULT 'us',
  status TEXT DEFAULT 'running',
  error_message TEXT,
  created_at TIMESTAMP DEFAULT now(),
  completed_at TIMESTAMP,
  browserbase_session_id TEXT
);
```

### audit_results table
```sql
CREATE TABLE audit_results (
  id UUID PRIMARY KEY,
  audit_id UUID NOT NULL REFERENCES audits(id),
  validation_layer TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  status TEXT NOT NULL,
  technical_details JSONB,
  business_impact TEXT,
  severity TEXT,
  created_at TIMESTAMP DEFAULT now()
);
```

### audit_reports table
```sql
CREATE TABLE audit_reports (
  id UUID PRIMARY KEY,
  audit_id UUID NOT NULL UNIQUE REFERENCES audits(id),
  report_json JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);
```

---

## 90-Day Sprint Plan

### Sprint 1 (Weeks 1-4): Foundation & Browserbase Integration
**Goal:** Get Browserbase audit engine working end-to-end

Key Tasks:
- Remove Phase 0-4 UI from React
- Create Audit Setup page
- Build Browserbase integration
- Implement dataLayer + network capture
- Store results in Supabase

Deliverable: End-to-end audit journey simulation working

### Sprint 2 (Weeks 5-8): Validation & Scoring Engine
**Goal:** Turn captured data into business-ready scores

Key Tasks:
- Implement 3 validation layers (8+12+6 rules)
- Build scoring engine (4 scores)
- Implement interpretation engine (tech → business impact)
- Finalize report_json schema
- Build test suite

Deliverable: All validation rules + scoring logic working

### Sprint 3 (Weeks 9-12): Marketing Reports & Export
**Goal:** Build 5-page report UI + export functionality

Key Tasks:
- Create all 5 report pages
- Implement PDF export
- Implement JSON export
- Add rate limiting by plan tier
- End-to-end integration tests

Deliverable: Full product MVP ready for launch

---

## Key Implementation Notes

### Browserbase Integration
- Use official Browserbase SDK (`npm install browserbase`)
- For MVP: manual URL configuration (user specifies landing → product → checkout → confirmation)
- Capture synthetic gclid/fbclid on landing
- Network interception: log all requests to GA4, Meta, Google Ads, sGTM

### Validation Engine
- Each rule is a pure function: `(auditData) => ValidationResult`
- All 26 rules already defined in `validation-rules.ts`
- Copy rules directly into backend, no guessing needed

### Interpretation Layer
- Critical: bridge between technical failures and marketing impact
- Use `rule-interpretations.ts` for all business_impact mappings
- Frontend receives already-translated output (never raw technical terms)

### Scoring System
Four scores (all required for MVP):
1. **Conversion Signal Health (0-100)** — Based on validation pass rate
2. **Attribution Risk Level** — Low/Medium/High/Critical (based on gclid/fbclid/transaction_id capture)
3. **Optimization Strength** — Weak/Moderate/Strong (based on user_data field completeness)
4. **Data Consistency Score** — Low/Medium/High (based on event_id deduplication)

### Frontend State
- Use Zustand for audit state (replaces project state)
- Poll GET /audits/:id/report every 2 seconds during audit
- Once completed, render report from API response

### Export Feature
- PDF: Use PDFKit or Puppeteer to render report pages
- JSON: Serialize entire report_json (include technical_appendix)
- ZIP: If exporting both, bundle as ZIP file

### Rate Limiting
- Free: 2 audits/month
- Pro: 20 audits/month
- Check profiles.plan before allowing audit
- Reject requests if user exceeds limit

---

## Success Criteria

### Sprint 1 Checkpoint
✅ Browserbase integration working
✅ dataLayer event capture working
✅ Network request interception working
✅ Audit Setup form working
✅ Progress indicator polling working

### Sprint 2 Checkpoint
✅ All 3 validation layers implemented & tested
✅ All 4 scores calculating correctly
✅ Interpretation engine mapping technical → business impact
✅ report_json schema finalized

### Sprint 3 Checkpoint
✅ All 5 report pages rendering
✅ PDF export working
✅ JSON export working
✅ Rate limiting by plan tier enforced
✅ End-to-end audit flow working
✅ Non-technical marketer can understand report without developer help

---

## Environment Variables

### Frontend (.env)
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_STRIPE_PRICE_PRO=price_xxx
VITE_STRIPE_PRICE_AGENCY=price_xxx
```

### Backend (.env)
```
BROWSERBASE_API_KEY=your-browserbase-key
REDIS_URL=redis://localhost:6379
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
```

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend | React 19 + TypeScript | Latest |
| State | Zustand | Latest |
| Styling | Tailwind CSS | Latest |
| Backend | Node.js/Express | LTS 20+ |
| Browser Automation | Browserbase API | Latest |
| Job Queue | Bull on Redis | Latest |
| PDF Generation | PDFKit or Puppeteer | Latest |
| Database | Supabase PostgreSQL | Latest |
| Auth | Supabase Auth | Latest |
| Testing | Vitest + Jest | Latest |

### New Dependencies to Add
- `browserbase` (npm) — Browserbase SDK
- `bull` (npm) — Job queue management
- `pdfkit` (npm) — PDF generation
- `jszip` (npm) — ZIP archives for multi-file exports

---

## Reusable Components from Existing Build

✅ **Keep:**
- React 19 + TypeScript setup
- Tailwind CSS + design system
- Zustand state management
- Supabase Auth (login/signup)
- Navigation structure (will simplify)
- Settings page
- Billing/Stripe integration (will extend for rate limiting)

❌ **Delete:**
- Phase 0 bookmarklet
- Phase 1 Discovery form
- Phase 2 Journey Designer
- Phase 3 Orchestration
- Phase 4 Export (GTM/server code)
- Projects sidebar

---

## Code Patterns

### Validation Rule Pattern
```typescript
export const MY_RULE = {
  rule_id: 'MY_RULE',
  validation_layer: 'signal_initiation',
  severity: 'critical',
  test: (auditData: AuditData): ValidationResult => {
    const passed = /* test logic */;
    return {
      rule_id: 'MY_RULE',
      validation_layer: 'signal_initiation',
      status: passed ? 'pass' : 'fail',
      severity: 'critical',
      technical_details: {
        found: /* what was found */,
        expected: /* what was expected */,
        evidence: [/* supporting evidence */]
      }
    };
  }
};
```

### API Endpoint Pattern
```typescript
// POST /api/audits/start
export const startAudit = async (req: Request, res: Response) => {
  const { website_url, funnel_type } = req.body;
  const user = req.user; // from auth middleware
  
  // Create audit record
  const audit = await auditQueries.create({
    user_id: user.id,
    website_url,
    funnel_type,
    status: 'running'
  });
  
  // Enqueue job
  await auditQueue.add('run-audit', { audit_id: audit.id });
  
  res.json({ audit_id: audit.id, status: 'queued' });
};
```

### Frontend Hook Pattern
```typescript
const useAudit = () => {
  const store = useAuditStore();
  const [isLoading, setIsLoading] = useState(false);
  
  const startAudit = async (websiteUrl: string, funnelType: string) => {
    setIsLoading(true);
    const { audit_id } = await auditApi.start({ website_url: websiteUrl, funnel_type: funnelType });
    store.setAudit({ id: audit_id });
    // ... poll status
  };
  
  return { startAudit, isLoading, audit: store.currentAudit };
};
```

---

## Testing Strategy

### Unit Tests
- Validation rules: test each rule with mock data
- Scoring: test score calculations with known inputs
- Interpretation: test rule_id → business_impact mapping

### Integration Tests
- Full audit flow: start → browserbase → validation → scoring → report
- Database persistence: audits table has correct data
- Export: PDF + JSON files are valid

### Manual Testing
- Sprint 1: Run audit on test site, verify data capture
- Sprint 2: Check scores are reasonable vs. known issues
- Sprint 3: Share PDF with non-technical person, verify understanding

---

## Launch Checklist

- [ ] Browserbase account set up with API key
- [ ] Redis instance running (for Bull job queue)
- [ ] Supabase migration applied (audits, audit_results, audit_reports tables)
- [ ] Env vars configured (BROWSERBASE_API_KEY, REDIS_URL, etc.)
- [ ] Rate limiting working per plan tier
- [ ] PDF + JSON exports tested
- [ ] End-to-end audit test passes on production domain
- [ ] Marketer onboarding flow documented
- [ ] Error logging dashboard set up
- [ ] Browserbase cost monitoring enabled

---

## Future Enhancements (v1.5+)

- [ ] AI-driven journey detection (auto-detect funnel URLs)
- [ ] Transmission & Compliance validation layers (2 more layers)
- [ ] Ongoing monitoring (schedule regular audits)
- [ ] Benchmarking dashboard (compare vs industry)
- [ ] WalkerOS integration
- [ ] Self-hosted Playwright option
- [ ] Team features (Agency plan)
- [ ] Audit history & trending

---

## Key Resources

- **Validation Rules:** `validation-rules.ts` (26 rules ready to code)
- **Rule Interpretations:** `rule-interpretations.ts` (tech → marketing mappings)
- **Sprint Roadmap:** `ATLAS_90Day_Sprint_Roadmap.docx`
- **Implementation Guide:** `ATLAS_Claude_Code_Implementation_Guide.md`
- **Cost Analysis:** `Playwright_Cost_Analysis.docx`
- **Gap Analysis:** `ATLAS_Gap_Analysis_First_Party_Platform.docx`

---

## Support & Questions

All specifications, rules, and implementation guides are complete. If you need clarification on:
- Specific validation rule logic
- Business impact wording
- Frontend component design
- API contract details
- Database schema

...refer to the implementation guide or the specific rule definition in `validation-rules.ts` and `rule-interpretations.ts`.

---

## Summary

**Atlas v1.0 MVP** is a fully-specified conversion signal auditor for marketers. Everything you need to build it is documented:

✅ 26 validation rules (ready to code)
✅ 3-sprint roadmap (task-by-task)
✅ Complete architecture (frontend + backend)
✅ API contracts (all endpoints defined)
✅ Database schema (SQL ready to run)
✅ Implementation patterns (code examples)

**Start with Sprint 1:** Build Browserbase integration + audit orchestrator. All rules, scoring logic, and business mappings are waiting in `validation-rules.ts` and `rule-interpretations.ts`.

Good luck! 🚀
