import { useEffect, useState } from 'react';
import type * as React from 'react';

import { useParams, useNavigate } from 'react-router-dom';
import { Settings, Users, Trash2, Save, MessageSquare, Plus, Trash, TestTube, ToggleLeft, ToggleRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { organisationApi } from '@/lib/api/organisationApi';
import { useOrganisationStore } from '@/store/organisationStore';
import { MemberManagement } from '@/components/organisation/MemberManagement';
import { useBillingStore } from '@/store/billingStore';
import { supabase } from '@/lib/supabase';
import type { Organisation, MemberRole } from '@/types/organisation';
import { slackApi } from '@/lib/api/slackApi';
import { useSlackStore } from '@/store/slackStore';
import type { SlackDestination } from '@/lib/api/slackApi';

export function OrgSettingsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const { setOrganisations, organisations } = useOrganisationStore();
  const { status: billingStatus, fetchStatus } = useBillingStore();

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
    fetchStatus();
  }, [fetchStatus]);

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
            plan={(billingStatus?.plan ?? 'free') as 'free' | 'pro' | 'agency'}
          />
        </CardContent>
      </Card>

      {/* Slack Destinations */}
      <SlackDestinationsCard plan={(billingStatus?.plan ?? 'free') as string} />

      {/* Danger zone — owner only */}
      {isOwner && (
        <Card className="border-red-200">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-red-500" />
              <CardTitle className="text-base text-red-600">Danger Zone</CardTitle>
            </div>
            <CardDescription>
              Permanently delete this organisation and all its clients, tracking kits, and outputs.
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

// ── Slack Destinations Card ───────────────────────────────────────────────────

function SlackDestinationsCard({ plan }: { plan: string }) {
  const { destinations, setDestinations, addDestination, updateDestination, removeDestination } = useSlackStore();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Add form state
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newChannel, setNewChannel] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Per-destination test state
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, 'ok' | 'fail'>>({});

  const isPro = plan === 'pro' || plan === 'agency';

  useEffect(() => {
    if (!isPro) return;
    slackApi.listDestinations()
      .then(setDestinations)
      .catch(() => setLoadError('Failed to load Slack destinations'));
  }, [isPro, setDestinations]);

  async function handleAdd() {
    setAddError(null);
    if (!newName.trim() || !newUrl.trim()) { setAddError('Name and webhook URL are required'); return; }
    if (!newUrl.startsWith('https://hooks.slack.com/')) {
      setAddError('URL must be a Slack Incoming Webhook (https://hooks.slack.com/…)');
      return;
    }
    setIsSaving(true);
    try {
      const dest = await slackApi.createDestination({
        name: newName.trim(),
        webhook_url: newUrl.trim(),
        channel_hint: newChannel.trim() || undefined,
      });
      addDestination(dest);
      setNewName(''); setNewUrl(''); setNewChannel('');
      setAdding(false);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleToggle(dest: SlackDestination) {
    try {
      const updated = await slackApi.updateDestination(dest.id, { enabled: !dest.enabled });
      updateDestination(updated);
    } catch {
      // ignore toggle errors silently
    }
  }

  async function handleDelete(id: string) {
    try {
      await slackApi.deleteDestination(id);
      removeDestination(id);
    } catch {
      // ignore
    }
  }

  async function handleTest(id: string) {
    setTestingId(id);
    try {
      await slackApi.testDestination(id);
      setTestResult((r) => ({ ...r, [id]: 'ok' }));
    } catch {
      setTestResult((r) => ({ ...r, [id]: 'fail' }));
    } finally {
      setTestingId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Slack Destinations</CardTitle>
          </div>
          {isPro && (
            <Button size="sm" variant="outline" onClick={() => setAdding((v) => !v)}>
              <Plus className="h-3 w-3 mr-1" />
              Add
            </Button>
          )}
        </div>
        <CardDescription>
          Configure Slack channels to share Atlas results (audits, briefs, reconciliation, and more).
          Requires Pro plan.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isPro && (
          <p className="text-sm text-muted-foreground">
            Upgrade to <strong>Pro</strong> to enable Slack sharing.
          </p>
        )}

        {isPro && loadError && (
          <p className="text-xs text-red-600">{loadError}</p>
        )}

        {isPro && adding && (
          <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
            <p className="text-sm font-medium">New destination</p>
            <Input
              placeholder="Name (e.g. Client Reports)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <Input
              placeholder="Webhook URL (https://hooks.slack.com/…)"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
            />
            <Input
              placeholder="Channel hint (optional, e.g. #atlas-reports)"
              value={newChannel}
              onChange={(e) => setNewChannel(e.target.value)}
            />
            {addError && <p className="text-xs text-red-600">{addError}</p>}
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAdd} disabled={isSaving}>
                {isSaving ? 'Saving…' : 'Save'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setAddError(null); }}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {isPro && destinations.length > 0 && (
          <ul className="divide-y">
            {destinations.map((dest) => (
              <li key={dest.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{dest.name}</p>
                  {dest.channel_hint && (
                    <p className="text-xs text-muted-foreground truncate">{dest.channel_hint}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {testResult[dest.id] && (
                    <span className={`text-xs ${testResult[dest.id] === 'ok' ? 'text-green-600' : 'text-red-600'}`}>
                      {testResult[dest.id] === 'ok' ? '✓ sent' : '✗ failed'}
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={testingId === dest.id}
                    onClick={() => handleTest(dest.id)}
                    title="Send test message"
                  >
                    <TestTube className="h-3 w-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleToggle(dest)}
                    title={dest.enabled ? 'Disable' : 'Enable'}
                  >
                    {dest.enabled
                      ? <ToggleRight className="h-4 w-4 text-green-600" />
                      : <ToggleLeft className="h-4 w-4 text-muted-foreground" />}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDelete(dest.id)}
                    title="Remove destination"
                  >
                    <Trash className="h-3 w-3 text-red-500" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {isPro && destinations.length === 0 && !adding && !loadError && (
          <p className="text-sm text-muted-foreground">No Slack destinations yet. Click Add to configure one.</p>
        )}
      </CardContent>
    </Card>
  );
}
