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
    'setup',            -- user entering URLs (steps 1–2)
    'scanning',         -- Browserbase + AI running
    'review_ready',     -- all pages scanned, ready for user review
    'generating',       -- output files being generated
    'outputs_ready',    -- all outputs available for download
    'failed'            -- scanning or generation failed
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
  screenshot_url TEXT,      -- Supabase Storage path (signed URL generated on demand)
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
  element_selector TEXT,
  element_text TEXT,
  element_type TEXT,

  -- What tracking Atlas recommends
  action_type TEXT NOT NULL,
  event_name TEXT NOT NULL,
  required_params JSONB NOT NULL DEFAULT '[]',
  optional_params JSONB NOT NULL DEFAULT '[]',

  -- Bounding box for annotated screenshot overlay (pixels, 1280×800 basis)
  bbox_x INTEGER,
  bbox_y INTEGER,
  bbox_width INTEGER,
  bbox_height INTEGER,

  -- AI confidence and justification
  confidence_score NUMERIC(3,2) NOT NULL DEFAULT 0.00 CHECK (confidence_score BETWEEN 0 AND 1),
  business_justification TEXT NOT NULL,

  -- Affected platforms
  affected_platforms TEXT[] NOT NULL DEFAULT '{}',

  -- User decision
  user_decision TEXT CHECK (user_decision IN ('approved', 'skipped', 'modified')),
  modified_config JSONB,
  decided_at TIMESTAMPTZ,

  -- Source
  source TEXT NOT NULL DEFAULT 'ai' CHECK (source IN ('ai', 'manual')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ============================================================
-- planning_outputs — generated output files
-- ============================================================
CREATE TABLE planning_outputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES planning_sessions(id) ON DELETE CASCADE,

  output_type TEXT NOT NULL CHECK (output_type IN (
    'gtm_container',
    'datalayer_spec',
    'implementation_guide',
    'walkeros_flow'
  )),

  -- Content storage
  content JSONB,
  content_text TEXT,
  storage_path TEXT,
  file_size_bytes INTEGER,
  mime_type TEXT NOT NULL DEFAULT 'application/json',

  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1
);


-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_planning_sessions_user_id       ON planning_sessions(user_id);
CREATE INDEX idx_planning_sessions_status         ON planning_sessions(status);
CREATE INDEX idx_planning_sessions_created_at     ON planning_sessions(created_at DESC);

CREATE INDEX idx_planning_pages_session_id        ON planning_pages(session_id);
CREATE INDEX idx_planning_pages_status            ON planning_pages(status);

CREATE INDEX idx_planning_recommendations_page_id        ON planning_recommendations(page_id);
CREATE INDEX idx_planning_recommendations_user_decision  ON planning_recommendations(user_decision);
CREATE INDEX idx_planning_recommendations_confidence     ON planning_recommendations(confidence_score DESC);

CREATE INDEX idx_planning_outputs_session_id      ON planning_outputs(session_id);
CREATE INDEX idx_planning_outputs_type            ON planning_outputs(output_type);


-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE planning_sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning_pages           ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning_outputs         ENABLE ROW LEVEL SECURITY;

-- Sessions: users see only their own
CREATE POLICY "Users can CRUD own planning sessions"
  ON planning_sessions FOR ALL
  USING (auth.uid() = user_id);

-- Pages: users see pages belonging to their sessions
CREATE POLICY "Users can CRUD own planning pages"
  ON planning_pages FOR ALL
  USING (session_id IN (
    SELECT id FROM planning_sessions WHERE user_id = auth.uid()
  ));

-- Recommendations: users see recs belonging to their pages
CREATE POLICY "Users can CRUD own planning recommendations"
  ON planning_recommendations FOR ALL
  USING (page_id IN (
    SELECT pp.id FROM planning_pages pp
    JOIN planning_sessions ps ON pp.session_id = ps.id
    WHERE ps.user_id = auth.uid()
  ));

-- Outputs: users see outputs belonging to their sessions
CREATE POLICY "Users can read own planning outputs"
  ON planning_outputs FOR ALL
  USING (session_id IN (
    SELECT id FROM planning_sessions WHERE user_id = auth.uid()
  ));
