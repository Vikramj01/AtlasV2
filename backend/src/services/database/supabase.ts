import { createClient } from '@supabase/supabase-js';
import { env } from '@/config/env';

// Admin client — uses service role key, bypasses RLS.
// ONLY use in backend. Never expose this key to the frontend.
export const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
