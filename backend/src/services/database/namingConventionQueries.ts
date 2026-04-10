import { supabaseAdmin as supabase } from './supabase';
import type { NamingConvention } from '../../types/taxonomy';

export const DEFAULT_CONVENTION: Omit<NamingConvention, 'id' | 'organization_id'> = {
  event_case: 'snake_case',
  param_case: 'snake_case',
  event_prefix: null,
  param_prefix: null,
  word_separator: '_',
  max_event_name_length: 40,
  max_param_key_length: 40,
  allowed_characters: 'a-z0-9_',
  reserved_words: ['event', 'page_view', 'session_start', 'first_visit', 'user_engagement'],
  example_event: 'add_to_cart',
  example_param: 'transaction_id',
};

/**
 * Returns the org's naming convention, or DEFAULT_CONVENTION if none configured.
 */
export async function getNamingConvention(orgId: string): Promise<NamingConvention> {
  const { data, error } = await supabase
    .from('naming_conventions')
    .select('*')
    .eq('organization_id', orgId)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to fetch naming convention: ${error.message}`);
  }

  if (!data) {
    return { ...DEFAULT_CONVENTION, organization_id: orgId };
  }
  return data as NamingConvention;
}

/**
 * Creates or updates the org's naming convention (upsert on organization_id).
 */
export async function upsertNamingConvention(
  orgId: string,
  updates: Partial<Omit<NamingConvention, 'id' | 'organization_id'>>,
): Promise<NamingConvention> {
  const { data, error } = await supabase
    .from('naming_conventions')
    .upsert(
      { organization_id: orgId, ...updates },
      { onConflict: 'organization_id' },
    )
    .select('*')
    .single();

  if (error) throw new Error(`Failed to upsert naming convention: ${error.message}`);
  return data as NamingConvention;
}
