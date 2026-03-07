import { createClient } from '@supabase/supabase-js';
import { env } from '@/config/env';

// Admin client — uses service role key, bypasses RLS.
// ONLY use in backend. Never expose this key to the frontend.
export const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/**
 * Upload a screenshot buffer to the private `planning-screenshots` bucket.
 * Path convention: {userId}/{sessionId}/{pageId}.jpg
 * Returns the storage path (not a public URL — use createSignedUrl() for access).
 */
export async function uploadScreenshot(
  userId: string,
  sessionId: string,
  pageId: string,
  buffer: Buffer,
): Promise<string> {
  const path = `${userId}/${sessionId}/${pageId}.jpg`;

  const { error } = await supabaseAdmin.storage
    .from('planning-screenshots')
    .upload(path, buffer, {
      contentType: 'image/jpeg',
      upsert: true,
    });

  if (error) throw new Error(`Screenshot upload failed: ${error.message}`);
  return path;
}

/**
 * Upload a generated output file (GTM JSON or HTML guide) to the
 * private `planning-outputs` bucket.
 * Path convention: {sessionId}/{filename}
 * Returns the storage path.
 */
export async function uploadOutput(
  sessionId: string,
  filename: string,
  content: Buffer | string,
  contentType: string,
): Promise<string> {
  const path = `${sessionId}/${filename}`;
  const body = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;

  const { error } = await supabaseAdmin.storage
    .from('planning-outputs')
    .upload(path, body, { contentType, upsert: true });

  if (error) throw new Error(`Output upload failed: ${error.message}`);
  return path;
}
export async function getScreenshotSignedUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabaseAdmin.storage
    .from('planning-screenshots')
    .createSignedUrl(storagePath, 1800); // 30 min

  if (error || !data?.signedUrl) {
    throw new Error(`Failed to create signed URL: ${error?.message ?? 'no URL returned'}`);
  }
  return data.signedUrl;
}
