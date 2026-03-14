/**
 * MemberManagement — invite, role-change, and remove team members from an org.
 * Intended for use inside OrgSettingsPage.
 */
import { useEffect, useState } from 'react';
import { UserPlus, Trash2, Crown, Shield, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { organisationApi } from '@/lib/api/organisationApi';
import type { OrganisationMember, MemberRole } from '@/types/organisation';

interface Props {
  orgId: string;
  currentUserId: string;
  currentUserRole: MemberRole;
}

const ROLE_ICONS: Record<MemberRole, typeof User> = {
  owner: Crown,
  admin: Shield,
  member: User,
};

const ROLE_COLOURS: Record<MemberRole, string> = {
  owner: 'bg-amber-50 text-amber-700 border-amber-200',
  admin: 'bg-blue-50 text-blue-700 border-blue-200',
  member: 'bg-gray-50 text-gray-600 border-gray-200',
};

export function MemberManagement({ orgId, currentUserId, currentUserRole }: Props) {
  const [members, setMembers] = useState<OrganisationMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Invite form
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<MemberRole>('member');
  const [isInviting, setIsInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // Per-row state
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [updatingRoleId, setUpdatingRoleId] = useState<string | null>(null);

  const canManage = currentUserRole === 'owner' || currentUserRole === 'admin';

  useEffect(() => {
    setIsLoading(true);
    organisationApi.listMembers(orgId)
      .then(setMembers)
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [orgId]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setIsInviting(true);
    setInviteError(null);
    try {
      const newMember = await organisationApi.inviteMember(orgId, inviteEmail.trim(), inviteRole);
      setMembers((prev) => [...prev, newMember]);
      setInviteEmail('');
      setInviteRole('member');
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Failed to invite member');
    } finally {
      setIsInviting(false);
    }
  }

  async function handleRoleChange(member: OrganisationMember, newRole: MemberRole) {
    setUpdatingRoleId(member.id);
    try {
      const updated = await organisationApi.updateMemberRole(orgId, member.id, newRole);
      setMembers((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
    } catch {
      // silently revert — row stays unchanged
    } finally {
      setUpdatingRoleId(null);
    }
  }

  async function handleRemove(memberId: string) {
    setRemovingId(memberId);
    try {
      await organisationApi.removeMember(orgId, memberId);
      setMembers((prev) => prev.filter((m) => m.id !== memberId));
    } catch {
      // silently revert
    } finally {
      setRemovingId(null);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-red-600 bg-red-50 rounded-lg p-4">{error}</p>;
  }

  return (
    <div className="space-y-6">
      {/* Member list */}
      <div className="divide-y rounded-lg border">
        {members.map((member) => {
          const RoleIcon = ROLE_ICONS[member.role];
          const isCurrentUser = member.user_id === currentUserId;
          const isOwner = member.role === 'owner';
          const isPending = !member.accepted_at;

          return (
            <div key={member.id} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                  <User className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {member.email ?? member.user_id.slice(0, 8) + '…'}
                    {isCurrentUser && (
                      <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>
                    )}
                  </p>
                  {isPending && (
                    <p className="text-xs text-amber-600">Invite pending</p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 ml-3">
                {/* Role selector or badge */}
                {canManage && !isOwner && !isCurrentUser ? (
                  <select
                    value={member.role}
                    disabled={updatingRoleId === member.id}
                    onChange={(e) => handleRoleChange(member, e.target.value as MemberRole)}
                    className="text-xs rounded-md border px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                  </select>
                ) : (
                  <span className={`inline-flex items-center gap-1 text-xs rounded-full border px-2 py-0.5 font-medium ${ROLE_COLOURS[member.role]}`}>
                    <RoleIcon className="h-3 w-3" />
                    {member.role}
                  </span>
                )}

                {/* Remove button */}
                {canManage && !isOwner && !isCurrentUser && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-red-600"
                    disabled={removingId === member.id}
                    onClick={() => handleRemove(member.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Invite form */}
      {canManage && (
        <form onSubmit={handleInvite} className="space-y-3">
          <p className="text-sm font-medium">Invite a team member</p>
          <div className="flex gap-2">
            <Input
              type="email"
              placeholder="colleague@company.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              required
              className="flex-1"
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as MemberRole)}
              className="text-sm rounded-md border px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <Button type="submit" disabled={isInviting} className="gap-2 shrink-0">
              <UserPlus className="h-4 w-4" />
              {isInviting ? 'Inviting…' : 'Invite'}
            </Button>
          </div>
          {inviteError && (
            <p className="text-xs text-red-600">{inviteError}</p>
          )}
          <p className="text-xs text-muted-foreground">
            <strong>Admin</strong> — can manage clients, signals, and members.{' '}
            <strong>Member</strong> — can view and generate outputs only.
          </p>
        </form>
      )}
    </div>
  );
}
