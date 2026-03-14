import { supabaseAdmin as supabase } from './supabase';
import type {
  Signal,
  SignalPack,
  SignalPackSignal,
  SignalPackWithSignals,
  Deployment,
  DeploymentWithSignals,
  SignalWithOverrides,
  CreateSignalRequest,
  UpdateSignalRequest,
  CreatePackRequest,
} from '../../types/signal';

// ─── Signals ──────────────────────────────────────────────────────────────────

export async function listSignals(orgId?: string): Promise<Signal[]> {
  let query = supabase.from('signals').select('*');

  if (orgId) {
    // System signals + org signals
    query = supabase
      .from('signals')
      .select('*')
      .or(`is_system.eq.true,organisation_id.eq.${orgId}`);
  } else {
    query = query.eq('is_system', true);
  }

  const { data, error } = await query.order('key');
  if (error) throw new Error(`Failed to list signals: ${error.message}`);
  return (data ?? []) as Signal[];
}

export async function getSignal(signalId: string): Promise<Signal | null> {
  const { data } = await supabase
    .from('signals')
    .select('*')
    .eq('id', signalId)
    .single();
  return (data as Signal | null);
}

export async function createSignal(data: CreateSignalRequest): Promise<Signal> {
  const { data: signal, error } = await supabase
    .from('signals')
    .insert({
      organisation_id: data.organisation_id,
      key: data.key,
      name: data.name,
      description: data.description,
      category: data.category,
      is_system: false,
      is_custom: true,
      required_params: data.required_params ?? [],
      optional_params: data.optional_params ?? [],
      platform_mappings: data.platform_mappings ?? {},
      walkeros_mapping: data.walkeros_mapping ?? null,
    })
    .select('*')
    .single();

  if (error) throw new Error(`Failed to create signal: ${error.message}`);
  return signal as Signal;
}

export async function updateSignal(
  signalId: string,
  orgId: string,
  data: UpdateSignalRequest,
): Promise<Signal> {
  const { data: signal, error } = await supabase
    .from('signals')
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq('id', signalId)
    .eq('organisation_id', orgId)  // only org-owned signals, not system
    .select('*')
    .single();

  if (error) throw new Error(`Failed to update signal: ${error.message}`);
  return signal as Signal;
}

export async function deleteSignal(signalId: string, orgId: string): Promise<void> {
  const { error } = await supabase
    .from('signals')
    .delete()
    .eq('id', signalId)
    .eq('organisation_id', orgId);
  if (error) throw new Error(`Failed to delete signal: ${error.message}`);
}

// ─── Signal Packs ─────────────────────────────────────────────────────────────

export async function listSignalPacks(orgId?: string): Promise<SignalPack[]> {
  let query = supabase.from('signal_packs').select('*');

  if (orgId) {
    query = supabase
      .from('signal_packs')
      .select('*')
      .or(`is_system.eq.true,organisation_id.eq.${orgId}`);
  } else {
    query = query.eq('is_system', true);
  }

  const { data, error } = await query.order('name');
  if (error) throw new Error(`Failed to list signal packs: ${error.message}`);
  return (data ?? []) as SignalPack[];
}

export async function getSignalPack(packId: string): Promise<SignalPack | null> {
  const { data } = await supabase
    .from('signal_packs')
    .select('*')
    .eq('id', packId)
    .single();
  return (data as SignalPack | null);
}

export async function getSignalPackWithSignals(packId: string): Promise<SignalPackWithSignals | null> {
  const pack = await getSignalPack(packId);
  if (!pack) return null;

  const { data, error } = await supabase
    .from('signal_pack_signals')
    .select('*, signals(*)')
    .eq('pack_id', packId)
    .order('display_order');

  if (error) return { ...pack, signals: [] };

  const signals: SignalPackSignal[] = (data ?? []).map((row: Record<string, unknown>) => ({
    ...(row as SignalPackSignal),
    signal: row['signals'] as Signal,
  }));

  return { ...pack, signals };
}

export async function createSignalPack(data: CreatePackRequest): Promise<SignalPack> {
  const { data: pack, error } = await supabase
    .from('signal_packs')
    .insert({
      organisation_id: data.organisation_id ?? null,
      name: data.name,
      description: data.description ?? null,
      business_type: data.business_type,
      is_system: false,
    })
    .select('*')
    .single();

  if (error) throw new Error(`Failed to create signal pack: ${error.message}`);
  return pack as SignalPack;
}

export async function updateSignalPack(
  packId: string,
  orgId: string,
  data: Partial<CreatePackRequest>,
): Promise<SignalPack> {
  const { data: pack, error } = await supabase
    .from('signal_packs')
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq('id', packId)
    .eq('organisation_id', orgId)
    .select('*')
    .single();

  if (error) throw new Error(`Failed to update signal pack: ${error.message}`);
  return pack as SignalPack;
}

export async function deleteSignalPack(packId: string, orgId: string): Promise<void> {
  const { error } = await supabase
    .from('signal_packs')
    .delete()
    .eq('id', packId)
    .eq('organisation_id', orgId);
  if (error) throw new Error(`Failed to delete signal pack: ${error.message}`);
}

export async function addSignalToPack(
  packId: string,
  signalId: string,
  stageHint?: string,
  isRequired = true,
): Promise<SignalPackSignal> {
  // Get current max display order
  const { data: existing } = await supabase
    .from('signal_pack_signals')
    .select('display_order')
    .eq('pack_id', packId)
    .order('display_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextOrder = existing ? (existing as { display_order: number }).display_order + 1 : 1;

  const { data, error } = await supabase
    .from('signal_pack_signals')
    .insert({ pack_id: packId, signal_id: signalId, stage_hint: stageHint ?? null, is_required: isRequired, display_order: nextOrder })
    .select('*')
    .single();

  if (error) throw new Error(`Failed to add signal to pack: ${error.message}`);

  // Update signals_count
  await supabase.rpc('increment_signals_count', { pack_id: packId }).catch(() => {
    // If the RPC doesn't exist, update manually
    supabase
      .from('signal_packs')
      .update({ signals_count: nextOrder })
      .eq('id', packId);
  });

  return data as SignalPackSignal;
}

export async function removeSignalFromPack(packId: string, signalId: string): Promise<void> {
  const { error } = await supabase
    .from('signal_pack_signals')
    .delete()
    .eq('pack_id', packId)
    .eq('signal_id', signalId);
  if (error) throw new Error(`Failed to remove signal from pack: ${error.message}`);
}

// ─── Resolve deployments for a client (for output generation) ─────────────────

export async function resolveDeploymentsForClient(
  clientId: string,
): Promise<DeploymentWithSignals[]> {
  const { data, error } = await supabase
    .from('deployments')
    .select('*, signal_packs(*, signal_pack_signals(*, signals(*)))')
    .eq('client_id', clientId);

  if (error) throw new Error(`Failed to resolve deployments: ${error.message}`);

  const results: DeploymentWithSignals[] = [];

  for (const row of (data ?? [])) {
    const deployment = row as Record<string, unknown>;
    const pack = deployment['signal_packs'] as Record<string, unknown> | null;
    if (!pack) continue;

    const packSignals = (pack['signal_pack_signals'] as Array<Record<string, unknown>>) ?? [];
    const overrides = (deployment['signal_overrides'] as Deployment['signal_overrides']) ?? {};

    const signals: SignalWithOverrides[] = packSignals.map((ps) => {
      const signal = ps['signals'] as Signal;
      const key = signal?.key ?? '';
      const override = overrides[key] ?? {};
      return {
        signal,
        stage_assignment: (override.stage_assignment ?? ps['stage_hint'] as string | null),
        param_overrides: override.param_overrides ?? {},
        enabled: override.enabled ?? true,
      };
    }).filter((s) => s.signal && s.enabled);

    results.push({
      deployment_id: deployment['id'] as string,
      pack_id: pack['id'] as string,
      pack_name: pack['name'] as string,
      signals,
    });
  }

  return results;
}

// ─── Clients using a pack (for version tracking UI) ──────────────────────────

export async function countClientsUsingPack(packId: string): Promise<number> {
  const { count } = await supabase
    .from('deployments')
    .select('*', { count: 'exact', head: true })
    .eq('pack_id', packId);
  return count ?? 0;
}

export async function incrementPackVersion(packId: string): Promise<void> {
  const { data } = await supabase
    .from('signal_packs')
    .select('version')
    .eq('id', packId)
    .single();
  if (!data) return;
  await supabase
    .from('signal_packs')
    .update({ version: (data as { version: number }).version + 1, updated_at: new Date().toISOString() })
    .eq('id', packId);
}
