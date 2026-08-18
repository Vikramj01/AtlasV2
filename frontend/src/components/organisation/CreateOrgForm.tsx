import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { organisationApi } from '@/lib/api/organisationApi';
import { useOrganisationStore } from '@/store/organisationStore';
import type { Organisation } from '@/types/organisation';

interface Props {
  onCreated: (org: Organisation) => void;
  onCancel?: () => void;
  submitLabel?: string;
  autoFocus?: boolean;
}

/**
 * Org creation form — shared by the sidebar's "Create workspace" dialog and
 * the full-page first-time setup screen. Owns the create call and store sync
 * (organisations list + currentOrg); the caller decides what happens next
 * (navigate, close a dialog, etc.) via onCreated.
 */
export function CreateOrgForm({ onCreated, onCancel, submitLabel = 'Create workspace', autoFocus = true }: Props) {
  const { setOrganisations, setCurrentOrg } = useOrganisationStore();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [orgType, setOrgType] = useState<'agency' | 'brand'>('agency');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toSlug(s: string) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function handleNameChange(v: string) {
    setName(v);
    if (!slugTouched) setSlug(toSlug(v));
  }

  const canSubmit = name.trim() && slug.trim() && (orgType === 'agency' || websiteUrl.trim());

  async function handleSubmit(e: { preventDefault: () => void }) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const org = await organisationApi.create({
        name: name.trim(),
        slug: slug.trim(),
        org_type: orgType,
        website_url: orgType === 'brand' ? websiteUrl.trim() : undefined,
      });
      const updated = await organisationApi.list();
      setOrganisations(updated);
      setCurrentOrg(org);
      onCreated(org);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workspace');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label>Workspace type</Label>
        <div className="grid grid-cols-2 gap-2">
          {(['agency', 'brand'] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setOrgType(type)}
              className={`rounded-lg border px-4 py-3 text-left text-sm transition-colors ${
                orgType === type
                  ? 'border-[#1B2A4A] bg-[#EEF1F7] font-medium text-[#1B2A4A]'
                  : 'border-border text-muted-foreground hover:border-[#1B2A4A]/40'
              }`}
            >
              <span className="font-medium block">
                {type === 'agency' ? 'Agency' : 'In-house marketer'}
              </span>
              <span className="text-xs mt-0.5 block">
                {type === 'agency' ? 'Managing multiple client sites' : 'Tracking my own website'}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="org-name">Workspace name</Label>
        <Input
          id="org-name"
          placeholder={orgType === 'brand' ? 'e.g. Acme Corp' : 'e.g. Spi3l Agency'}
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          autoFocus={autoFocus}
        />
      </div>

      {orgType === 'brand' && (
        <div className="space-y-1.5">
          <Label htmlFor="org-website">Your website URL</Label>
          <Input
            id="org-website"
            type="url"
            placeholder="https://example.com"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
          />
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="org-slug">URL slug</Label>
        <Input
          id="org-slug"
          placeholder="e.g. acme-corp"
          value={slug}
          onChange={(e) => { setSlugTouched(true); setSlug(toSlug(e.target.value)); }}
        />
        <p className="text-xs text-muted-foreground">Lowercase letters, numbers and hyphens only.</p>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex justify-end gap-2 pt-2">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          disabled={saving || !canSubmit}
          className="bg-[#1B2A4A] text-white hover:bg-[#1B2A4A]/90"
        >
          {saving ? 'Creating…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}
