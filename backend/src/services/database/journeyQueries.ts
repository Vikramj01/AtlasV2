import { supabaseAdmin as supabase } from './supabase';
import type {
  Journey,
  JourneyStage,
  JourneyPlatform,
  GeneratedSpec,
  JourneyTemplate,
  CreateJourneyRequest,
  UpdateJourneyRequest,
  UpsertStageRequest,
  UpsertPlatformsRequest,
  SpecFormat,
} from '../../types/journey';

// ── Journeys ──────────────────────────────────────────────────────────────────

export async function createJourney(userId: string, data: CreateJourneyRequest): Promise<Journey> {
  const { data: journey, error } = await supabase
    .from('journeys')
    .insert({
      user_id: userId,
      name: data.name || 'Untitled Journey',
      business_type: data.business_type,
      implementation_format: data.implementation_format || 'gtm',
    })
    .select('*')
    .single();

  if (error) throw new Error(`Failed to create journey: ${error.message}`);
  return journey as Journey;
}

export async function listJourneys(userId: string): Promise<Journey[]> {
  const { data, error } = await supabase
    .from('journeys')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to list journeys: ${error.message}`);
  return (data || []) as Journey[];
}

export async function getJourney(journeyId: string, userId: string): Promise<Journey | null> {
  const { data, error } = await supabase
    .from('journeys')
    .select('*')
    .eq('id', journeyId)
    .eq('user_id', userId)
    .single();

  if (error?.code === 'PGRST116') return null;
  if (error) throw new Error(`Failed to get journey: ${error.message}`);
  return data as Journey;
}

export async function getJourneyWithDetails(journeyId: string, userId: string): Promise<{
  journey: Journey;
  stages: JourneyStage[];
  platforms: JourneyPlatform[];
} | null> {
  const journey = await getJourney(journeyId, userId);
  if (!journey) return null;

  const [stages, platforms] = await Promise.all([
    getJourneyStages(journeyId),
    getJourneyPlatforms(journeyId),
  ]);

  return { journey, stages, platforms };
}

export async function updateJourney(journeyId: string, userId: string, data: UpdateJourneyRequest): Promise<Journey> {
  const { data: journey, error } = await supabase
    .from('journeys')
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq('id', journeyId)
    .eq('user_id', userId)
    .select('*')
    .single();

  if (error) throw new Error(`Failed to update journey: ${error.message}`);
  return journey as Journey;
}

export async function deleteJourney(journeyId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('journeys')
    .delete()
    .eq('id', journeyId)
    .eq('user_id', userId);

  if (error) throw new Error(`Failed to delete journey: ${error.message}`);
}

// ── Stages ────────────────────────────────────────────────────────────────────

export async function getJourneyStages(journeyId: string): Promise<JourneyStage[]> {
  const { data, error } = await supabase
    .from('journey_stages')
    .select('*')
    .eq('journey_id', journeyId)
    .order('stage_order', { ascending: true });

  if (error) throw new Error(`Failed to get stages: ${error.message}`);
  return (data || []) as JourneyStage[];
}

export async function upsertStage(journeyId: string, data: UpsertStageRequest): Promise<JourneyStage> {
  const { data: stage, error } = await supabase
    .from('journey_stages')
    .upsert({
      journey_id: journeyId,
      stage_order: data.stage_order,
      label: data.label,
      page_type: data.page_type,
      sample_url: data.sample_url ?? null,
      actions: data.actions,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'journey_id,stage_order' })
    .select('*')
    .single();

  if (error) throw new Error(`Failed to upsert stage: ${error.message}`);
  return stage as JourneyStage;
}

export async function updateStage(stageId: string, data: Partial<UpsertStageRequest>): Promise<JourneyStage> {
  const { data: stage, error } = await supabase
    .from('journey_stages')
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq('id', stageId)
    .select('*')
    .single();

  if (error) throw new Error(`Failed to update stage: ${error.message}`);
  return stage as JourneyStage;
}

export async function deleteStage(stageId: string, journeyId: string): Promise<void> {
  const { error } = await supabase
    .from('journey_stages')
    .delete()
    .eq('id', stageId)
    .eq('journey_id', journeyId);

  if (error) throw new Error(`Failed to delete stage: ${error.message}`);
}

export async function reorderStages(journeyId: string, stageIds: string[]): Promise<void> {
  const updates = stageIds.map((id, index) => ({
    id,
    stage_order: index + 1,
    updated_at: new Date().toISOString(),
  }));

  for (const update of updates) {
    const { error } = await supabase
      .from('journey_stages')
      .update({ stage_order: update.stage_order, updated_at: update.updated_at })
      .eq('id', update.id)
      .eq('journey_id', journeyId);

    if (error) throw new Error(`Failed to reorder stages: ${error.message}`);
  }
}

// ── Platforms ─────────────────────────────────────────────────────────────────

export async function getJourneyPlatforms(journeyId: string): Promise<JourneyPlatform[]> {
  const { data, error } = await supabase
    .from('journey_platforms')
    .select('*')
    .eq('journey_id', journeyId);

  if (error) throw new Error(`Failed to get platforms: ${error.message}`);
  return (data || []) as JourneyPlatform[];
}

export async function upsertPlatforms(journeyId: string, data: UpsertPlatformsRequest): Promise<JourneyPlatform[]> {
  const rows = data.platforms.map((p) => ({
    journey_id: journeyId,
    platform: p.platform,
    is_active: p.is_active,
    measurement_id: p.measurement_id ?? null,
    config: p.config ?? {},
  }));

  const { data: platforms, error } = await supabase
    .from('journey_platforms')
    .upsert(rows, { onConflict: 'journey_id,platform' })
    .select('*');

  if (error) throw new Error(`Failed to upsert platforms: ${error.message}`);
  return (platforms || []) as JourneyPlatform[];
}

// ── Generated Specs ───────────────────────────────────────────────────────────

export async function saveGeneratedSpec(journeyId: string, format: SpecFormat, specData: unknown): Promise<GeneratedSpec> {
  // Get current max version for this journey+format
  const { data: existing } = await supabase
    .from('generated_specs')
    .select('version')
    .eq('journey_id', journeyId)
    .eq('format', format)
    .order('version', { ascending: false })
    .limit(1)
    .single();

  const nextVersion = (existing?.version || 0) + 1;

  const { data: spec, error } = await supabase
    .from('generated_specs')
    .insert({
      journey_id: journeyId,
      format,
      spec_data: specData,
      version: nextVersion,
    })
    .select('*')
    .single();

  if (error) throw new Error(`Failed to save spec: ${error.message}`);
  return spec as GeneratedSpec;
}

export async function getLatestSpec(journeyId: string, format: SpecFormat): Promise<GeneratedSpec | null> {
  const { data, error } = await supabase
    .from('generated_specs')
    .select('*')
    .eq('journey_id', journeyId)
    .eq('format', format)
    .order('version', { ascending: false })
    .limit(1)
    .single();

  if (error?.code === 'PGRST116') return null;
  if (error) throw new Error(`Failed to get spec: ${error.message}`);
  return data as GeneratedSpec;
}

export async function listSpecs(journeyId: string): Promise<GeneratedSpec[]> {
  const { data, error } = await supabase
    .from('generated_specs')
    .select('*')
    .eq('journey_id', journeyId)
    .order('generated_at', { ascending: false });

  if (error) throw new Error(`Failed to list specs: ${error.message}`);
  return (data || []) as GeneratedSpec[];
}

// ── Templates ─────────────────────────────────────────────────────────────────

export async function listTemplates(userId: string): Promise<JourneyTemplate[]> {
  const { data, error } = await supabase
    .from('journey_templates')
    .select('*')
    .or(`is_system.eq.true,user_id.eq.${userId},is_shared.eq.true`)
    .order('is_system', { ascending: false });

  if (error) throw new Error(`Failed to list templates: ${error.message}`);
  return (data || []) as JourneyTemplate[];
}

export async function getTemplate(templateId: string): Promise<JourneyTemplate | null> {
  const { data, error } = await supabase
    .from('journey_templates')
    .select('*')
    .eq('id', templateId)
    .single();

  if (error?.code === 'PGRST116') return null;
  if (error) throw new Error(`Failed to get template: ${error.message}`);
  return data as JourneyTemplate;
}

export async function saveTemplate(
  userId: string,
  name: string,
  description: string | null,
  businessType: string,
  templateData: unknown,
  isShared = false,
): Promise<JourneyTemplate> {
  const { data, error } = await supabase
    .from('journey_templates')
    .insert({
      user_id: userId,
      name,
      description,
      business_type: businessType,
      is_system: false,
      is_shared: isShared,
      template_data: templateData,
    })
    .select('*')
    .single();

  if (error) throw new Error(`Failed to save template: ${error.message}`);
  return data as JourneyTemplate;
}

export async function deleteTemplate(templateId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('journey_templates')
    .delete()
    .eq('id', templateId)
    .eq('user_id', userId);

  if (error) throw new Error(`Failed to delete template: ${error.message}`);
}
