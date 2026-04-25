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
// ── Strategy Brief PDF storage ─────────────────────────────────────────────────

/**
 * Upload a strategy brief PDF to the private `strategy-briefs` bucket.
 * Path: {orgId}/{briefId}/v{versionNo}.pdf
 */
export async function uploadStrategyBriefPdf(
  orgId: string,
  briefId: string,
  versionNo: number,
  buffer: Buffer,
): Promise<string> {
  const path = `${orgId}/${briefId}/v${versionNo}.pdf`;
  const { error } = await supabaseAdmin.storage
    .from('strategy-briefs')
    .upload(path, buffer, { contentType: 'application/pdf', upsert: true });
  if (error) throw new Error(`PDF upload failed: ${error.message}`);
  return path;
}

/**
 * Create a 1-hour signed URL for a strategy brief PDF.
 */
export async function getStrategyBriefSignedUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabaseAdmin.storage
    .from('strategy-briefs')
    .createSignedUrl(storagePath, 3600);
  if (error || !data?.signedUrl) {
    throw new Error(`Failed to create signed URL: ${error?.message ?? 'no URL returned'}`);
  }
  return data.signedUrl;
}

export async function getScreenshotSignedUrl(storagePath: string): Promise<string> {
  console.log('[screenshot] createSignedUrl path:', storagePath);

  const { data, error } = await supabaseAdmin.storage
    .from('planning-screenshots')
    .createSignedUrl(storagePath, 1800); // 30 min

  if (error || !data?.signedUrl) {
    const msg = `Failed to create signed URL for path "${storagePath}": ${error?.message ?? 'no URL returned'}`;
    console.error('[screenshot]', msg);
    throw new Error(msg);
  }

  console.log('[screenshot] signed URL created OK');
  return data.signedUrl;
}
