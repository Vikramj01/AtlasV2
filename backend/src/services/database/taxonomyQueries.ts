import { supabaseAdmin as supabase } from './supabase';
import type {
  TaxonomyNode,
  TaxonomySearchResult,
  CreateTaxonomyEventRequest,
  CreateTaxonomyCategoryRequest,
  UpdateTaxonomyNodeRequest,
} from '../../types/taxonomy';

// ─── Read ──────────────────────────────────────────────────────────────────────

/**
 * Fetch all taxonomy nodes visible to an org (system nodes + org's own nodes),
 * excluding deprecated entries. Returns a flat list — use taxonomyTreeBuilder
 * to convert to a nested tree.
 */
export async function fetchTaxonomyFlat(orgId: string): Promise<TaxonomyNode[]> {
  const { data, error } = await supabase
    .from('event_taxonomy')
    .select('*')
    .or(`organization_id.is.null,organization_id.eq.${orgId}`)
    .eq('deprecated', false)
    .order('depth')
    .order('display_order');

  if (error) throw new Error(`Failed to fetch taxonomy: ${error.message}`);
  return (data ?? []) as TaxonomyNode[];
}

/**
 * Fetch only event leaf nodes (node_type = 'event'), with optional filters.
 */
export async function fetchTaxonomyEvents(
  orgId: string,
  filters?: { category?: string; funnel_stage?: string },
): Promise<TaxonomyNode[]> {
  let query = supabase
    .from('event_taxonomy')
    .select('*')
    .or(`organization_id.is.null,organization_id.eq.${orgId}`)
    .eq('node_type', 'event')
    .eq('deprecated', false);

  if (filters?.category) {
    // Filter by path prefix, e.g., category = 'ecommerce'
    query = query.ilike('path', `${filters.category}%`);
  }
  if (filters?.funnel_stage) {
    query = query.eq('funnel_stage', filters.funnel_stage);
  }

  const { data, error } = await query.order('path');
  if (error) throw new Error(`Failed to fetch taxonomy events: ${error.message}`);
  return (data ?? []) as TaxonomyNode[];
}

/**
 * Fetch a taxonomy event node by slug, visible to the given org.
 * Returns the first matching event node (system or org-owned) or null.
 * Used to link AI-recommended event names back to taxonomy entries.
 */
export async function fetchTaxonomyEventBySlug(
  orgId: string,
  slug: string,
): Promise<TaxonomyNode | null> {
  const { data, error } = await supabase
    .from('event_taxonomy')
    .select('*')
    .or(`organization_id.is.null,organization_id.eq.${orgId}`)
    .eq('node_type', 'event')
    .eq('slug', slug)
    .eq('deprecated', false)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Failed to fetch taxonomy event by slug: ${error.message}`);
  return (data as TaxonomyNode | null);
}

/**
 * Fetch a single taxonomy node by ID.
 */
export async function fetchTaxonomyNode(id: string): Promise<TaxonomyNode | null> {
  const { data, error } = await supabase
    .from('event_taxonomy')
    .select('*')
    .eq('id', id)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to fetch taxonomy node: ${error.message}`);
  }
  return (data as TaxonomyNode | null);
}

/**
 * Full-text search across event name, slug, and description.
 */
export async function searchTaxonomy(
  orgId: string,
  query: string,
): Promise<TaxonomySearchResult[]> {
  const { data, error } = await supabase
    .from('event_taxonomy')
    .select('id, path, slug, name, description, node_type, funnel_stage, is_system')
    .or(`organization_id.is.null,organization_id.eq.${orgId}`)
    .eq('deprecated', false)
    .or(`name.ilike.%${query}%,slug.ilike.%${query}%,description.ilike.%${query}%`)
    .order('is_system', { ascending: false }) // system events first
    .order('path')
    .limit(50);

  if (error) throw new Error(`Taxonomy search failed: ${error.message}`);
  return (data ?? []) as TaxonomySearchResult[];
}

/**
 * Get the platform-specific mapping for a single event node.
 */
export async function fetchPlatformMapping(
  eventId: string,
  platform: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from('event_taxonomy')
    .select('platform_mappings')
    .eq('id', eventId)
    .single();

  if (error) throw new Error(`Failed to fetch platform mapping: ${error.message}`);
  if (!data?.platform_mappings) return null;

  const mappings = data.platform_mappings as Record<string, unknown>;
  return (mappings[platform] as Record<string, unknown>) ?? null;
}

// ─── Write ─────────────────────────────────────────────────────────────────────

/**
 * Create a custom event node under an existing category path.
 * Validates that the parent path exists before inserting.
 */
export async function createCustomTaxonomyEvent(
  req: CreateTaxonomyEventRequest,
): Promise<TaxonomyNode> {
  // Resolve parent node
  const { data: parent, error: parentError } = await supabase
    .from('event_taxonomy')
    .select('id, depth')
    .eq('path', req.parent_path)
    .or(`organization_id.is.null,organization_id.eq.${req.organization_id}`)
    .single();

  if (parentError || !parent) {
    throw new Error(`Parent path "${req.parent_path}" not found in taxonomy`);
  }

  const path = `${req.parent_path}/${req.slug}`;
  const depth = (parent.depth as number) + 1;

  const { data, error } = await supabase
    .from('event_taxonomy')
    .insert({
      organization_id: req.organization_id,
      parent_id: parent.id,
      path,
      depth,
      slug: req.slug,
      name: req.name,
      description: req.description ?? null,
      node_type: 'event',
      funnel_stage: req.funnel_stage ?? null,
      parameter_schema: req.parameter_schema,
      platform_mappings: req.platform_mappings ?? null,
      icon: req.icon ?? null,
      is_system: false,
      is_custom: true,
    })
    .select('*')
    .single();

  if (error) throw new Error(`Failed to create taxonomy event: ${error.message}`);
  return data as TaxonomyNode;
}

/**
 * Create a custom category node.
 */
export async function createCustomTaxonomyCategory(
  req: CreateTaxonomyCategoryRequest,
): Promise<TaxonomyNode> {
  let parentId: string | null = null;
  let depth = 0;
  let path = req.slug;

  if (req.parent_path) {
    const { data: parent, error: parentError } = await supabase
      .from('event_taxonomy')
      .select('id, depth')
      .eq('path', req.parent_path)
      .or(`organization_id.is.null,organization_id.eq.${req.organization_id}`)
      .single();

    if (parentError || !parent) {
      throw new Error(`Parent path "${req.parent_path}" not found in taxonomy`);
    }
    parentId = parent.id as string;
    depth = (parent.depth as number) + 1;
    path = `${req.parent_path}/${req.slug}`;
  }

  const { data, error } = await supabase
    .from('event_taxonomy')
    .insert({
      organization_id: req.organization_id,
      parent_id: parentId,
      path,
      depth,
      slug: req.slug,
      name: req.name,
      description: req.description ?? null,
      node_type: 'category',
      icon: req.icon ?? null,
      is_system: false,
      is_custom: true,
    })
    .select('*')
    .single();

  if (error) throw new Error(`Failed to create taxonomy category: ${error.message}`);
  return data as TaxonomyNode;
}

/**
 * Update a custom taxonomy node. System nodes are rejected at the route level
 * (RLS also enforces this), but we guard here too.
 */
export async function updateTaxonomyNode(
  id: string,
  orgId: string,
  updates: UpdateTaxonomyNodeRequest,
): Promise<TaxonomyNode> {
  const { data, error } = await supabase
    .from('event_taxonomy')
    .update({ ...updates })
    .eq('id', id)
    .eq('organization_id', orgId)
    .eq('is_system', false)
    .select('*')
    .single();

  if (error) throw new Error(`Failed to update taxonomy node: ${error.message}`);
  return data as TaxonomyNode;
}

/**
 * Soft-delete: marks a custom node as deprecated.
 * System nodes cannot be deprecated via this function (RLS + explicit guard).
 */
export async function deprecateTaxonomyNode(id: string, orgId: string): Promise<void> {
  const { error } = await supabase
    .from('event_taxonomy')
    .update({ deprecated: true })
    .eq('id', id)
    .eq('organization_id', orgId)
    .eq('is_system', false);

  if (error) throw new Error(`Failed to deprecate taxonomy node: ${error.message}`);
}

/**
 * Check whether any active signals are linked to a taxonomy node.
 * Used to warn the user before deprecating an event.
 */
export async function countSignalsForTaxonomyEvent(eventId: string): Promise<number> {
  const { count, error } = await supabase
    .from('signals')
    .select('id', { count: 'exact', head: true })
    .eq('taxonomy_event_id', eventId);

  if (error) throw new Error(`Failed to count signals for taxonomy event: ${error.message}`);
  return count ?? 0;
}
