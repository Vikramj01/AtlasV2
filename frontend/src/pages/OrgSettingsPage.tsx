import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Settings, Users, Trash2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { organisationApi } from '@/lib/api/organisationApi';
import { useOrganisationStore } from '@/store/organisationStore';
import { MemberManagement } from '@/components/organisation/MemberManagement';
import { supabase } from '@/lib/supabase';
import type { Organisation, MemberRole } from '@/types/organisation';

export function OrgSettingsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const { setOrganisations, organisations } = useOrganisationStore();

  const [org, setOrg] = useState<Organisation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Current user
  const [currentUserId, setCurrentUserId] = useState('');
  const [currentUserRole, setCurrentUserRole] = useState<MemberRole>('member');

  // Rename form
  const [orgName, setOrgName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Delete org
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) return;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) setCurrentUserId(session.user.id);
    });

    setIsLoading(true);
    Promise.all([
      organisationApi.get(orgId),
      organisationApi.listMembers(orgId),
    ])
      .then(([orgData, members]) => {
        setOrg(orgData);
        setOrgName(orgData.name);
        const me = members.find((m) => m.user_id === currentUserId);
        if (me) setCurrentUserRole(me.role);
        // Owner is always determined by owner_id
        if (orgData.owner_id === currentUserId) setCurrentUserRole('owner');
      })
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [orgId, currentUserId]);

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId || !orgName.trim() || orgName.trim() === org?.name) return;
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const updated = await organisationApi.update(orgId, { name: orgName.trim() });
      setOrg(updated);
      setSaveSuccess(true);
      // Refresh sidebar org list
      organisationApi.list().then(setOrganisations).catch(() => {});
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteOrg() {
    if (!orgId || deleteConfirm !== org?.name) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await organisationApi.delete(orgId);
      // Remove from store and redirect
      const remaining = organisations.filter((o) => o.id !== orgId);
      setOrganisations(remaining);
      navigate('/home');
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete organisation');
      setIsDeleting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
      </div>
    );
  }

  if (error) {
    return <p className="p-6 text-sm text-red-600 bg-red-50 rounded-lg">{error}</p>;
  }

  const isOwner = currentUserRole === 'owner';
  const canManage = isOwner || currentUserRole === 'admin';

  return (
    <div className="space-y-6 p-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Settings className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-xl font-bold">Organisation Settings</h1>
      </div>

      {/* General */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">General</CardTitle>
          <CardDescription>Update your organisation's display name.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSaveName} className="flex gap-3">
            <Input
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              disabled={!canManage}
              className="flex-1"
              placeholder="Organisation name"
            />
            <Button
              type="submit"
              disabled={!canManage || isSaving || orgName.trim() === org?.name}
              className="gap-2 shrink-0"
            >
              <Save className="h-4 w-4" />
              {isSaving ? 'Saving…' : 'Save'}
            </Button>
          </form>
          {saveSuccess && <p className="mt-2 text-xs text-green-600">Name updated.</p>}
          {saveError && <p className="mt-2 text-xs text-red-600">{saveError}</p>}
        </CardContent>
      </Card>

      {/* Team members */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Team Members</CardTitle>
          </div>
          <CardDescription>
            Manage who has access to this organisation and their roles.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MemberManagement
            orgId={orgId!}
            currentUserId={currentUserId}
            currentUserRole={currentUserRole}
          />
        </CardContent>
      </Card>

      {/* Danger zone — owner only */}
      {isOwner && (
        <Card className="border-red-200">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-red-500" />
              <CardTitle className="text-base text-red-600">Danger Zone</CardTitle>
            </div>
            <CardDescription>
              Permanently delete this organisation and all its clients, signal packs, and outputs.
              This cannot be undone.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Type <strong className="text-foreground">{org?.name}</strong> to confirm deletion.
            </p>
            <Input
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder={org?.name}
              className="border-red-200 focus-visible:ring-red-400"
            />
            <Button
              variant="destructive"
              disabled={deleteConfirm !== org?.name || isDeleting}
              onClick={handleDeleteOrg}
              className="w-full"
            >
              {isDeleting ? 'Deleting…' : 'Delete organisation permanently'}
            </Button>
            {deleteError && <p className="text-xs text-red-600">{deleteError}</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
