import { supabaseAdmin as supabase } from './supabase';
import type {
  Organisation,
  OrganisationMember,
  OrgWithStats,
  CreateOrgRequest,
  UpdateOrgRequest,
  MemberRole,
} from '../../types/organisation';

// ─── Organisations ─────────────────────────────────────────────────────────────

export async function createOrganisation(
  ownerId: string,
  data: CreateOrgRequest,
): Promise<Organisation> {
  const { data: org, error } = await supabase
    .from('organisations')
    .insert({ owner_id: ownerId, name: data.name, slug: data.slug, plan: 'agency' })
    .select('*')
    .single();

  if (error) throw new Error(`Failed to create organisation: ${error.message}`);

  // Auto-add owner as a member
  await supabase.from('organisation_members').insert({
    organisation_id: (org as Organisation).id,
    user_id: ownerId,
    role: 'owner',
    accepted_at: new Date().toISOString(),
  });

  return org as Organisation;
}

export async function listOrganisations(userId: string): Promise<Organisation[]> {
  const { data, error } = await supabase
    .from('organisation_members')
    .select('organisation_id')
    .eq('user_id', userId);

  if (error) throw new Error(`Failed to list memberships: ${error.message}`);
  const orgIds = (data ?? []).map((r: { organisation_id: string }) => r.organisation_id);
  if (orgIds.length === 0) return [];

  const { data: orgs, error: orgsError } = await supabase
    .from('organisations')
    .select('*')
    .in('id', orgIds)
    .order('created_at', { ascending: false });

  if (orgsError) throw new Error(`Failed to fetch organisations: ${orgsError.message}`);
  return (orgs ?? []) as Organisation[];
}

export async function getOrganisation(orgId: string): Promise<OrgWithStats | null> {
  const { data, error } = await supabase
    .from('organisations')
    .select('*')
    .eq('id', orgId)
    .single();

  if (error) return null;
  const org = data as Organisation;

  const [{ count: memberCount }, { count: clientCount }] = await Promise.all([
    supabase.from('organisation_members').select('*', { count: 'exact', head: true }).eq('organisation_id', orgId),
    supabase.from('clients').select('*', { count: 'exact', head: true }).eq('organisation_id', orgId),
  ]);

  return { ...org, member_count: memberCount ?? 0, client_count: clientCount ?? 0 };
}

export async function updateOrganisation(
  orgId: string,
  data: UpdateOrgRequest,
): Promise<Organisation> {
  const { data: org, error } = await supabase
    .from('organisations')
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq('id', orgId)
    .select('*')
    .single();

  if (error) throw new Error(`Failed to update organisation: ${error.message}`);
  return org as Organisation;
}

export async function deleteOrganisation(orgId: string): Promise<void> {
  const { error } = await supabase.from('organisations').delete().eq('id', orgId);
  if (error) throw new Error(`Failed to delete organisation: ${error.message}`);
}

export async function isOrgMember(orgId: string, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('organisation_members')
    .select('id')
    .eq('organisation_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();
  return !!data;
}

export async function getOrgMembership(
  orgId: string,
  userId: string,
): Promise<OrganisationMember | null> {
  const { data } = await supabase
    .from('organisation_members')
    .select('*')
    .eq('organisation_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();
  return (data as OrganisationMember | null);
}

// ─── Members ──────────────────────────────────────────────────────────────────

export async function listMembers(orgId: string): Promise<OrganisationMember[]> {
  const { data, error } = await supabase
    .from('organisation_members')
    .select('*')
    .eq('organisation_id', orgId)
    .order('invited_at', { ascending: true });

  if (error) throw new Error(`Failed to list members: ${error.message}`);
  return (data ?? []) as OrganisationMember[];
}

export async function inviteMember(
  orgId: string,
  userId: string,
  role: MemberRole = 'member',
): Promise<OrganisationMember> {
  const { data, error } = await supabase
    .from('organisation_members')
    .insert({ organisation_id: orgId, user_id: userId, role })
    .select('*')
    .single();

  if (error) throw new Error(`Failed to invite member: ${error.message}`);
  return data as OrganisationMember;
}

export async function removeMember(orgId: string, memberId: string): Promise<void> {
  const { error } = await supabase
    .from('organisation_members')
    .delete()
    .eq('id', memberId)
    .eq('organisation_id', orgId);
  if (error) throw new Error(`Failed to remove member: ${error.message}`);
}

export async function updateMemberRole(
  orgId: string,
  memberId: string,
  role: MemberRole,
): Promise<OrganisationMember> {
  const { data, error } = await supabase
    .from('organisation_members')
    .update({ role })
    .eq('id', memberId)
    .eq('organisation_id', orgId)
    .select('*')
    .single();

  if (error) throw new Error(`Failed to update member role: ${error.message}`);
  return data as OrganisationMember;
}
