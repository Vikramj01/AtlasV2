-- Create the signal-validator-reports storage bucket for Campaign Signal
-- Validator PDF exports (B9). PDFs are stored at {run_id}.pdf — access is via
-- signed URLs generated server-side, same pattern as strategy-briefs
-- (20260425_001_strategy_briefs_storage.sql). Never public: the standalone
-- flow's result page is gated by a Stripe checkout session id, not the bucket.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'signal-validator-reports',
  'signal-validator-reports',
  false,
  10485760,            -- 10 MB per PDF
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO NOTHING;
