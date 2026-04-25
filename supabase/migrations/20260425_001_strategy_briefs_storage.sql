-- Create the strategy-briefs storage bucket for PDF exports.
-- PDFs are stored at {organization_id}/{brief_id}/v{version_no}.pdf
-- Access is via signed URLs generated server-side — the bucket is never public.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'strategy-briefs',
  'strategy-briefs',
  false,
  10485760,            -- 10 MB per PDF
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO NOTHING;
