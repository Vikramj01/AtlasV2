import { supabaseAdmin } from './supabase';
import type { OrgSubscription, CapViolation } from '../../types/subscription';

export async function getActiveSubscription(orgId: string): Promise<OrgSubscription | null> {
  const { data, error } = await supabaseAdmin
    .from('org_active_subscriptions')
    .select('*')
    .eq('org_id', orgId)
    .maybeSingle();

  if (error) throw new Error(`Failed to fetch active subscription: ${error.message}`);
  return data as OrgSubscription | null;
}

export async function listActiveSubscriptions(): Promise<OrgSubscription[]> {
  const { data, error } = await supabaseAdmin
    .from('org_active_subscriptions')
    .select('*');

  if (error) throw new Error(`Failed to list active subscriptions: ${error.message}`);
  return (data ?? []) as OrgSubscription[];
}

export async function upsertCapViolation(
  v: Omit<CapViolation, 'id' | 'created_at'>,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('cap_violations')
    .insert({
      org_id:     v.org_id,
      cap_type:   v.cap_type,
      domain:     v.domain ?? null,
      cap_value:  v.cap_value,
      actual:     v.actual,
      usage_pct:  v.usage_pct,
      severity:   v.severity,
      resolved:   v.resolved,
      resolved_at: v.resolved_at ?? null,
      resolution:  v.resolution ?? null,
    });

  if (error) throw new Error(`Failed to insert cap violation: ${error.message}`);
}

export async function listOpenViolations(orgId: string): Promise<CapViolation[]> {
  const { data, error } = await supabaseAdmin
    .from('cap_violations')
    .select('*')
    .eq('org_id', orgId)
    .eq('resolved', false)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to list open violations: ${error.message}`);
  return (data ?? []) as CapViolation[];
}

export async function resolveViolation(id: string, resolution: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('cap_violations')
    .update({
      resolved:    true,
      resolved_at: new Date().toISOString(),
      resolution,
    })
    .eq('id', id);

  if (error) throw new Error(`Failed to resolve violation: ${error.message}`);
}
