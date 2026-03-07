# Atlas Planning Mode — Database Migration Plan

**Migration file:** `db/migrations/003_create_planning_tables.sql`
**Runs after:** `002_create_journey_tables.sql`
**Target:** Supabase PostgreSQL

## How to Apply

Apply via the Supabase SQL Editor (Dashboard → SQL Editor → paste and run), or via the Supabase CLI:

```bash
supabase db push
```

If using the Supabase dashboard directly, paste the SQL below into the SQL editor and run it.

---

## Dependencies on Existing Tables

- `planning_sessions.user_id` → `auth.users(id)` (Supabase auth users table)
- `planning_pages.session_id` → `planning_sessions(id)`
- `planning_recommendations.page_id` → `planning_pages(id)`
- `planning_outputs.session_id` → `planning_sessions(id)`

No dependencies on the audit or journey tables — Planning Mode is standalone until the handoff step, which creates Journey records using the existing `journeys` table.

---

## Full Migration SQL

```sql
-- ============================================================
-- PLANNING MODE TABLES
-- Migration: 003_create_planning_tables.sql
-- Depends on: 001_create_audit_tables.sql, 002_create_journey_tables.sql
-- ============================================================


-- ============================================================
-- planning_sessions — one session per user site analysis
-- ============================================================
CREATE TABLE planning_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Site context (filled at Step 1)
  website_url TEXT NOT NULL,
  business_type TEXT NOT NULL CHECK (business_type IN (
    'ecommerce', 'saas', 'lead_gen', 'content', 'marketplace', 'custom'
  )),
  business_description TEXT,
  selected_platforms TEXT[] NOT NULL DEFAULT '{}',

  -- Session lifecycle
  status TEXT NOT NULL DEFAULT 'setup' CHECK (status IN (
    'setup',          -- user entering URLs (steps 1–2)
    'scanning',       -- Browserbase + AI running
    'review_ready',   -- all pages scanned, ready for user review
    'generating',     -- output files being generated
    'outputs_ready',  -- all outputs available for download
    'failed'          -- scanning or generation failed
  )),
  error_message TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- Trigger: auto-update updated_at
CREATE OR REPLACE FUNCTION update_planning_session_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER planning_sessions_updated_at
  BEFORE UPDATE ON planning_sessions
  FOR EACH ROW EXECUTE FUNCTION update_planning_session_updated_at();


-- ============================================================
-- planning_pages — one row per URL within a session
-- ============================================================
CREATE TABLE planning_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES planning_sessions(id) ON DELETE CASCADE,

  -- Page identity
  url TEXT NOT NULL,
  page_type TEXT NOT NULL DEFAULT 'custom' CHECK (page_type IN (
    'landing', 'product', 'category', 'cart', 'checkout', 'confirmation',
    'pricing', 'features', 'sign_up', 'form', 'article', 'listing',
    'booking', 'search_results', 'custom'
  )),
  page_order INTEGER NOT NULL DEFAULT 0,

  -- Capture metadata
  page_title TEXT,
  meta_description TEXT,
  screenshot_url TEXT,    -- Supabase Storage URL (signed URL generated on demand)
  screenshot_width INTEGER,
  screenshot_height INTEGER,

  -- Detected existing tracking (from PLATFORM_SCHEMAS detection)
  existing_tracking JSONB NOT NULL DEFAULT '[]',
  -- Example: [{ "platform": "ga4", "detected_via": "script_tag", "detail": "googletagmanager.com/gtag" }]

  -- Scan status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',   -- waiting to be scanned
    'scanning',  -- Browserbase session active
    'done',      -- scan complete, recommendations created
    'failed'     -- scan failed (error stored in error_message)
  )),
  error_message TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  scanned_at TIMESTAMPTZ
);


-- ============================================================
-- planning_recommendations — AI-generated element recommendations
-- ============================================================
CREATE TABLE planning_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES planning_pages(id) ON DELETE CASCADE,

  -- What the AI found
  element_selector TEXT,         -- CSS selector or descriptive label (e.g., '#checkout-btn')
  element_text TEXT,             -- Visible text of the element
  element_type TEXT,             -- 'button' | 'link' | 'form' | 'input' | 'heading' | 'image'

  -- What tracking Atlas recommends
  action_type TEXT NOT NULL,     -- Must match an ACTION_PRIMITIVES key (e.g., 'purchase', 'sign_up')
  event_name TEXT NOT NULL,      -- Specific event name (e.g., 'purchase', 'generate_lead')
  required_params JSONB NOT NULL DEFAULT '[]',  -- Array of { param, description, example }
  optional_params JSONB NOT NULL DEFAULT '[]',

  -- Bounding box for annotated screenshot overlay (in pixels, based on 1280×800 capture)
  bbox_x INTEGER,
  bbox_y INTEGER,
  bbox_width INTEGER,
  bbox_height INTEGER,

  -- AI confidence and justification
  confidence_score NUMERIC(3,2) NOT NULL DEFAULT 0.00 CHECK (confidence_score BETWEEN 0 AND 1),
  business_justification TEXT NOT NULL,  -- Plain English from Claude

  -- Affected platforms (from session.selected_platforms filtered by relevance)
  affected_platforms TEXT[] NOT NULL DEFAULT '{}',

  -- User decision
  user_decision TEXT CHECK (user_decision IN ('approved', 'skipped', 'modified')),
  modified_config JSONB,         -- Overrides if user modified the recommendation
  decided_at TIMESTAMPTZ,

  -- Source
  source TEXT NOT NULL DEFAULT 'ai' CHECK (source IN ('ai', 'manual')),
  -- 'manual' = user added via CustomElementForm

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ============================================================
-- planning_outputs — generated output files
-- ============================================================
CREATE TABLE planning_outputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES planning_sessions(id) ON DELETE CASCADE,

  -- Output type
  output_type TEXT NOT NULL CHECK (output_type IN (
    'gtm_container',       -- Importable GTM container JSON
    'datalayer_spec',      -- Developer-ready dataLayer code spec
    'implementation_guide', -- HTML implementation guide
    'walkeros_flow'        -- WalkerOS flow.json (optional)
  )),

  -- Content storage
  content JSONB,             -- For JSON outputs (gtm_container, datalayer_spec, walkeros_flow)
  content_text TEXT,         -- For text/HTML outputs (implementation_guide)
  storage_path TEXT,         -- Supabase Storage path for file download
  file_size_bytes INTEGER,
  mime_type TEXT NOT NULL DEFAULT 'application/json',

  -- Generation metadata
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1  -- Increments if user regenerates
);


-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_planning_sessions_user_id ON planning_sessions(user_id);
CREATE INDEX idx_planning_sessions_status ON planning_sessions(status);
CREATE INDEX idx_planning_sessions_created_at ON planning_sessions(created_at DESC);

CREATE INDEX idx_planning_pages_session_id ON planning_pages(session_id);
CREATE INDEX idx_planning_pages_status ON planning_pages(status);

CREATE INDEX idx_planning_recommendations_page_id ON planning_recommendations(page_id);
CREATE INDEX idx_planning_recommendations_user_decision ON planning_recommendations(user_decision);
CREATE INDEX idx_planning_recommendations_confidence ON planning_recommendations(confidence_score DESC);

CREATE INDEX idx_planning_outputs_session_id ON planning_outputs(session_id);
CREATE INDEX idx_planning_outputs_type ON planning_outputs(output_type);


-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE planning_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning_outputs ENABLE ROW LEVEL SECURITY;

-- Sessions: users see only their own
CREATE POLICY "Users can CRUD own planning sessions"
  ON planning_sessions
  FOR ALL
  USING (auth.uid() = user_id);

-- Pages: users see pages belonging to their sessions
CREATE POLICY "Users can CRUD own planning pages"
  ON planning_pages
  FOR ALL
  USING (session_id IN (
    SELECT id FROM planning_sessions WHERE user_id = auth.uid()
  ));

-- Recommendations: users see recs belonging to their pages
CREATE POLICY "Users can CRUD own planning recommendations"
  ON planning_recommendations
  FOR ALL
  USING (page_id IN (
    SELECT pp.id FROM planning_pages pp
    JOIN planning_sessions ps ON pp.session_id = ps.id
    WHERE ps.user_id = auth.uid()
  ));

-- Outputs: users see outputs belonging to their sessions
CREATE POLICY "Users can read own planning outputs"
  ON planning_outputs
  FOR ALL
  USING (session_id IN (
    SELECT id FROM planning_sessions WHERE user_id = auth.uid()
  ));
```

---

## Supabase Storage Setup (Manual — Not SQL)

The migration above handles only database tables. Supabase Storage buckets must be created manually via the dashboard:

1. Go to Supabase Dashboard → Storage
2. Create new bucket: `planning-screenshots`
   - **Access:** Private (not public)
   - **File size limit:** 5 MB per file (screenshots are JPEG ~200–500 KB)
3. Storage bucket policy — add via Storage → Policies:
   ```sql
   -- Allow authenticated users to upload to their own folder
   CREATE POLICY "Users can upload own screenshots"
     ON storage.objects
     FOR INSERT
     TO authenticated
     WITH CHECK (bucket_id = 'planning-screenshots' AND auth.uid()::text = (storage.foldername(name))[1]);

   -- Allow authenticated users to read their own screenshots
   CREATE POLICY "Users can read own screenshots"
     ON storage.objects
     FOR SELECT
     TO authenticated
     USING (bucket_id = 'planning-screenshots' AND auth.uid()::text = (storage.foldername(name))[1]);
   ```
4. Screenshot file naming convention: `{userId}/{sessionId}/{pageId}.jpg`
   - This structure ensures the storage policy (based on folder = userId) enforces isolation

Similarly for generated outputs:

5. Create bucket: `planning-outputs` (private)
   - Same access policies as above but with `bucket_id = 'planning-outputs'`
6. Output file naming convention: `{userId}/{sessionId}/{outputType}.json` or `.html`

---

## Data Lifecycle Notes

- Screenshots are captured during scanning (Sprint PM-2) and kept for the session lifetime
- Outputs are generated once and versioned if regenerated (Sprint PM-3)
- If a user deletes a planning session (`ON DELETE CASCADE`), all related pages, recommendations, and output DB records are deleted automatically
- Storage files (screenshots, outputs) are **not** automatically deleted by Supabase cascade — implement a cleanup job or Supabase Edge Function to delete orphaned storage files when sessions are deleted
- PII: The only PII in planning tables is the website URL (not sensitive), and potentially email addresses captured in form detection (stored in `planning_recommendations.element_text` if a form's placeholder says "Your email"). This is informational only and does not constitute PII capture.

---

## Migration Order Verification

Before running `003_create_planning_tables.sql`, verify the following tables exist:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('profiles', 'audits', 'journeys', 'journey_stages');
```

All 4 should be present. If not, run `001_create_audit_tables.sql` and `002_create_journey_tables.sql` first.

---

## Rollback

To roll back this migration (removes all Planning Mode data):

```sql
-- WARNING: This drops all planning data irreversibly.
DROP TABLE IF EXISTS planning_outputs CASCADE;
DROP TABLE IF EXISTS planning_recommendations CASCADE;
DROP TABLE IF EXISTS planning_pages CASCADE;
DROP TABLE IF EXISTS planning_sessions CASCADE;
DROP FUNCTION IF EXISTS update_planning_session_updated_at CASCADE;
DROP TRIGGER IF EXISTS planning_sessions_updated_at ON planning_sessions;
```

Also manually delete the `planning-screenshots` and `planning-outputs` storage buckets from the Supabase dashboard.
