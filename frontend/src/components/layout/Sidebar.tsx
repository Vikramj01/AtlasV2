import { useEffect, useState } from 'react';
import { NavLink, useParams, useNavigate } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  Home, MapPin, CheckCircle, Clock, Settings, HelpCircle,
  Building2, LayoutGrid, ShieldCheck, Activity,
  HeartPulse, ShieldAlert, GitBranch, Tag,
  Link2, ArrowLeftRight, Plus, Target, Zap, BarChart2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { OrgSwitcher } from '@/components/organisation/OrgSwitcher';
import { useOrganisationStore } from '@/store/organisationStore';
import { organisationApi } from '@/lib/api/organisationApi';
import { SECTION_LABELS } from '@/lib/ui-copy';
import { dashboardApi } from '@/lib/api/dashboardApi';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// ── Nav data ──────────────────────────────────────────────────────────────────

type NavItemDef = { label: string; technicalLabel?: string; to: string; Icon: LucideIcon; end?: boolean; step?: number; stepKey?: string };

const PERSONAL_NAV_GROUPS: { label: string; items: NavItemDef[] }[] = [
  {
    label: 'WORKSPACE',
    items: [
      { label: 'Home', to: '/', Icon: Home, end: true },
    ],
  },
  {
    label: 'SET UP',
    items: [
      { label: SECTION_LABELS.conversionStrategyGate.primary, technicalLabel: SECTION_LABELS.conversionStrategyGate.technical, to: '/planning/strategy', Icon: Target,      step: 1, stepKey: 'strategy'      },
      { label: SECTION_LABELS.planningMode.primary,            technicalLabel: SECTION_LABELS.planningMode.technical,            to: '/planning',          Icon: MapPin,      step: 2, stepKey: 'site-scan'     },
      { label: SECTION_LABELS.journeyBuilder.primary,          technicalLabel: SECTION_LABELS.journeyBuilder.technical,          to: '/journey/new',       Icon: CheckCircle, step: 3, stepKey: 'tracking-plan' },
      { label: SECTION_LABELS.tagLibrary.primary,              technicalLabel: SECTION_LABELS.tagLibrary.technical,              to: '/signals',           Icon: Tag,         step: 4, stepKey: 'tag-library'   },
      { label: SECTION_LABELS.consentHub.primary,              technicalLabel: SECTION_LABELS.consentHub.technical,              to: '/consent',           Icon: ShieldCheck, step: 5, stepKey: 'consent'       },
      { label: SECTION_LABELS.capi.primary,                    technicalLabel: SECTION_LABELS.capi.technical,                    to: '/integrations/capi',     Icon: Activity,    step: 6, stepKey: 'capi'          },
      { label: 'Bid Signal Enricher',                           technicalLabel: 'bid_signal_enricher',                            to: '/integrations/enricher', Icon: Zap,                                                    },
      { label: SECTION_LABELS.platformConnections.primary,     technicalLabel: SECTION_LABELS.platformConnections.technical,     to: '/connections',           Icon: Link2,       step: 7, stepKey: 'connections'   },
    ],
  },
  {
    label: 'MONITOR',
    items: [
      { label: SECTION_LABELS.signalTracking.primary,   technicalLabel: SECTION_LABELS.signalTracking.technical,   to: '/signal-tracking',Icon: Activity },
      { label: SECTION_LABELS.signalHealth.primary,     technicalLabel: SECTION_LABELS.signalHealth.technical,     to: '/health',         Icon: HeartPulse },
      { label: SECTION_LABELS.auditEngine.primary,      technicalLabel: SECTION_LABELS.auditEngine.technical,      to: '/dashboard',      Icon: Clock },
      { label: SECTION_LABELS.channelInsights.primary,  technicalLabel: SECTION_LABELS.channelInsights.technical,  to: '/channels',       Icon: GitBranch },
      { label: SECTION_LABELS.reconciliation.primary,   technicalLabel: SECTION_LABELS.reconciliation.technical,   to: '/reconciliation', Icon: ArrowLeftRight },
    ],
  },
];

function orgNav(orgId: string, orgType: 'agency' | 'brand' = 'agency', primaryClientId?: string | null): NavItemDef[] {
  const isBrand = orgType === 'brand';

  const clientsItem: NavItemDef = isBrand && primaryClientId
    ? { label: 'My Tracking', to: `/clients/${primaryClientId}/tracking`, Icon: MapPin }
    : { label: 'Clients', to: `/org/${orgId}/clients`, Icon: Building2 };

  return [
    { label: 'Overview',                                                                                          to: `/org/${orgId}`,          Icon: Home },
    clientsItem,
    ...(isBrand ? [] : [
      { label: 'Data Manager', to: `/org/${orgId}/data-manager`, Icon: BarChart2 } as NavItemDef,
      { label: 'Tracking Map', to: `/org/${orgId}/signals`,      Icon: MapPin }    as NavItemDef,
      { label: 'Templates',    to: `/org/${orgId}/packs`,        Icon: LayoutGrid } as NavItemDef,
    ]),
    { label: SECTION_LABELS.planningMode.primary,   technicalLabel: SECTION_LABELS.planningMode.technical,   to: '/planning',              Icon: MapPin },
    { label: SECTION_LABELS.auditEngine.primary,    technicalLabel: SECTION_LABELS.auditEngine.technical,    to: '/dashboard',             Icon: Clock },
    { label: SECTION_LABELS.channelInsights.primary,technicalLabel: SECTION_LABELS.channelInsights.technical,to: '/channels',              Icon: GitBranch },
    { label: SECTION_LABELS.capi.primary,           technicalLabel: SECTION_LABELS.capi.technical,           to: '/integrations/capi',     Icon: Activity },
    { label: 'Bid Signal Enricher',                 technicalLabel: 'bid_signal_enricher',                    to: '/integrations/enricher', Icon: Zap },
    { label: SECTION_LABELS.consentHub.primary,     technicalLabel: SECTION_LABELS.consentHub.technical,     to: '/consent',               Icon: ShieldCheck },
    { label: SECTION_LABELS.signalHealth.primary,   technicalLabel: SECTION_LABELS.signalHealth.technical,   to: '/health',                Icon: HeartPulse },
    { label: 'Team & Settings',                                                                                   to: `/org/${orgId}/settings`, Icon: Settings },
  ];
}

// ── Shared nav item styles ────────────────────────────────────────────────────

const NAV_BASE =
  'group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-100 w-full';

const NAV_ACTIVE =
  'bg-[#1B2A4A] text-white';

const NAV_INACTIVE =
  'text-[#6B7280] hover:bg-[#F9FAFB] hover:text-[#1A1A1A]';

// ── Nav item component ────────────────────────────────────────────────────────

function SidebarNavItem({ label, technicalLabel, to, Icon, end = false, step, done = false }: NavItemDef & { done?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => cn(NAV_BASE, isActive ? NAV_ACTIVE : NAV_INACTIVE)}
    >
      {({ isActive }) => (
        <>
          {step !== undefined ? (
            <span className={cn(
              'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold mt-0.5 transition-colors',
              isActive
                ? 'border-white text-white bg-transparent'
                : done
                  ? 'border-emerald-500 bg-emerald-500 text-white'
                  : 'border-[#9CA3AF] text-[#9CA3AF] group-hover:border-[#1A1A1A] group-hover:text-[#1A1A1A]',
            )}>
              {done && !isActive ? '✓' : step}
            </span>
          ) : (
            <Icon
              className={cn(
                'h-5 w-5 shrink-0 mt-0.5',
                isActive ? 'text-white' : 'text-[#9CA3AF] group-hover:text-[#1A1A1A]',
              )}
              strokeWidth={1.5}
            />
          )}
          <span className="flex flex-col min-w-0">
            <span className="leading-snug">{label}</span>
            {technicalLabel && (
              <span className={cn(
                'text-[10px] leading-tight font-normal truncate',
                isActive ? 'text-white/60' : 'text-[#9CA3AF]',
              )}>
                {technicalLabel}
              </span>
            )}
          </span>
        </>
      )}
    </NavLink>
  );
}

// ── Create Org Dialog ─────────────────────────────────────────────────────────

function CreateOrgDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
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

  const canSubmit =
    name.trim() && slug.trim() && (orgType === 'agency' || websiteUrl.trim());

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
      onOpenChange(false);
      if (orgType === 'brand' && org.primary_client_id) {
        navigate(`/clients/${org.primary_client_id}/tracking`);
      } else {
        navigate(`/org/${org.id}/clients`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workspace');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create your workspace</DialogTitle>
          <DialogDescription>
            Set up a workspace to manage your tracking work.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {/* Org type selector */}
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
              autoFocus
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
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving || !canSubmit}
              className="bg-[#1B2A4A] text-white hover:bg-[#1B2A4A]/90"
            >
              {saving ? 'Creating…' : 'Create workspace'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function Sidebar({ isAdmin = false }: { isAdmin?: boolean }) {
  const { currentOrg, organisations, setOrganisations } = useOrganisationStore();
  const params = useParams<{ orgId?: string; clientId?: string }>();
  const [createOrgOpen, setCreateOrgOpen] = useState(false);
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);

  useEffect(() => {
    organisationApi.list()
      .then(setOrganisations)
      .catch(() => { /* non-blocking */ });
  }, [setOrganisations]);

  useEffect(() => {
    dashboardApi.getSetupProgress()
      .then(({ data }) => setCompletedSteps(data.completedSteps))
      .catch(() => { /* non-blocking — sidebar degrades gracefully without ticks */ });
  }, []);

  const activeOrgId = params.orgId ?? currentOrg?.id;
  const activeClientId = params.clientId;

  return (
    <>
    <aside
      className="flex h-full flex-col border-r border-[#E5E7EB] bg-white"
      style={{ width: 240, minWidth: 240 }}
    >
      {/* ── Logo ──────────────────────────────────────────────────────────── */}
      <div className="border-b border-[#E5E7EB]">
        <img
          src="/atlas_latest_logo.svg"
          alt="Atlas"
          className="block w-full"
          style={{ height: 64, objectFit: 'cover', objectPosition: 'center' }}
        />
      </div>

      {/* ── Workspace switcher ────────────────────────────────────────────── */}
      {organisations.length > 0 ? (
        <div className="px-3 pt-3">
          <OrgSwitcher />
        </div>
      ) : (
        <div className="px-3 pt-3">
          <button
            type="button"
            onClick={() => setCreateOrgOpen(true)}
            className="flex w-full items-center gap-2 rounded-lg border border-dashed border-[#1B2A4A]/30 bg-[#EEF1F7]/60 px-3 py-2.5 text-sm text-[#1B2A4A] hover:bg-[#EEF1F7] transition-colors"
          >
            <Plus className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left font-medium">Create workspace</span>
          </button>
        </div>
      )}

      {/* ── Navigation ───────────────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto px-3 py-2">
        {activeOrgId ? (
          // Org context: flat list with org header
          <>
            <p className="text-caption-upper px-3 pb-2 pt-2">
              {currentOrg?.name ?? 'Organisation'}
            </p>
            <div className="space-y-0.5">
              {orgNav(activeOrgId, currentOrg?.org_type, currentOrg?.primary_client_id).map((item) => (
                <SidebarNavItem key={item.to} {...item} />
              ))}
            </div>
            {activeClientId && (
              <div className="mt-2 border-t border-[#E5E7EB] pt-2">
                <p className="text-caption-upper px-3 pb-1 pt-1">This client</p>
                <SidebarNavItem
                  label="Set up tracking"
                  to={`/clients/${activeClientId}/tracking`}
                  Icon={MapPin}
                />
              </div>
            )}
          </>
        ) : (
          // Personal context: grouped nav
          <>
            {PERSONAL_NAV_GROUPS.map(({ label, items }) => (
              <div key={label} className="mb-1">
                <p role="presentation" className="text-caption-upper px-3 pb-1 pt-3">
                  {label}
                </p>
                <div className="space-y-0.5">
                  {items.map((item) => (
                    <SidebarNavItem
                      key={item.to}
                      {...item}
                      done={item.stepKey ? completedSteps.includes(item.stepKey) : false}
                    />
                  ))}
                </div>
              </div>
            ))}
            {/* Settings & Help — standalone below divider */}
            <div className="mt-3 border-t border-[#E5E7EB] pt-2">
              <SidebarNavItem label="Help" to="/help" Icon={HelpCircle} />
              <SidebarNavItem label="Settings" to="/settings" Icon={Settings} />
            </div>
          </>
        )}
      </nav>

      {/* ── Admin section ─────────────────────────────────────────────────── */}
      {isAdmin && (
        <div className="border-t border-[#E5E7EB] px-3 py-3">
          <p className="text-caption-upper px-3 pb-2">Admin</p>
          <SidebarNavItem label="Platform Admin" to="/admin" Icon={ShieldAlert} />
        </div>
      )}
    </aside>

    <CreateOrgDialog open={createOrgOpen} onOpenChange={setCreateOrgOpen} />
    </>
  );
}
