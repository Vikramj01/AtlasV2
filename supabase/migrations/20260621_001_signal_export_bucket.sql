-- Create the signal-exports storage bucket.
-- This bucket stores generated CSV exports; access is via 24-hour signed URLs
-- produced by the backend service role (which bypasses RLS).
-- The bucket is private (public = false) so no object is directly reachable
-- without a valid signed URL.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'signal-exports',
  'signal-exports',
  false,
  209715200,        -- 200 MB hard cap (100k rows × ~2 KB/row)
  ARRAY['text/csv', 'text/plain']
)
ON CONFLICT (id) DO NOTHING;
