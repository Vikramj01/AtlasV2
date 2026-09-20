import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { NavLink, useParams, useNavigate } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  Home, MapPin, CheckCircle, Clock, Settings, HelpCircle,
  Building2, LayoutGrid, ShieldCheck, Activity,
  HeartPulse, ShieldAlert, GitBranch, Tag,
  Link2, ArrowLeftRight, Plus, Target, Zap, BarChart2,
  ChevronDown, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { OrgSwitcher } from '@/components/organisation/OrgSwitcher';
import { useOrganisationStore } from '@/store/organisationStore';
import { organisationApi } from '@/lib/api/organisationApi';
import { SECTION_LABELS } from '@/lib/ui-copy';
import { dashboardApi } from '@/lib/api/dashboardApi';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { CreateOrgForm } from '@/components/organisation/CreateOrgForm';
import type { Organisation } from '@/types/organisation';

// ── Nav data ──────────────────────────────────────────────────────────────────

type OrgNavGroup = 'WORKSPACE' | 'ENGINE' | 'LIBRARY' | 'IMPLEMENTATION' | 'TRACKING' | 'ADVANCED' | 'PRIVACY';

type NavItemDef = { label: string; technicalLabel?: string; to: string; Icon: LucideIcon; end?: boolean; step?: number; stepKey?: string; group?: OrgNavGroup };

// Org-context nav groups, in display order — mirrors the canonical grouping
// from the Stitch "operator console" redesign mockups.
const ORG_NAV_GROUPS: { label: OrgNavGroup; storageKey: string }[] = [
  { label: 'WORKSPACE',      storageKey: 'atlas.sidebar.org.workspace' },
  { label: 'ENGINE',         storageKey: 'atlas.sidebar.org.engine' },
  { label: 'LIBRARY',        storageKey: 'atlas.sidebar.org.library' },
  { label: 'IMPLEMENTATION', storageKey: 'atlas.sidebar.org.implementation' },
  { label: 'TRACKING',       storageKey: 'atlas.sidebar.org.tracking' },
  { label: 'ADVANCED',       storageKey: 'atlas.sidebar.org.advanced' },
  { label: 'PRIVACY',        storageKey: 'atlas.sidebar.org.privacy' },
];

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
    ? { label: 'My Tracking', to: `/clients/${primaryClientId}/tracking`, Icon: MapPin, group: 'WORKSPACE' }
    : { label: 'Clients', to: `/org/${orgId}/clients`, Icon: Building2, group: 'WORKSPACE' };

  return [
    // ── Workspace ──────────────────────────────────────────────────────────
    { label: 'Overview',                                                                                          to: `/org/${orgId}`,          Icon: Home, group: 'WORKSPACE' },
    clientsItem,
    ...(isBrand ? [] : [
      { label: 'Data Manager', to: `/org/${orgId}/data-manager`, Icon: BarChart2, group: 'WORKSPACE' } as NavItemDef,
      { label: 'Tracking Map', to: `/org/${orgId}/signals`,      Icon: MapPin,    group: 'WORKSPACE' } as NavItemDef,
    ]),
    // ── Engine ─────────────────────────────────────────────────────────────
    { label: SECTION_LABELS.planningMode.primary,   technicalLabel: SECTION_LABELS.planningMode.technical,   to: '/planning',              Icon: MapPin,      group: 'ENGINE' },
    { label: SECTION_LABELS.journeyBuilder.primary, technicalLabel: SECTION_LABELS.journeyBuilder.technical, to: '/journey/new',           Icon: CheckCircle, group: 'ENGINE' },
    { label: SECTION_LABELS.auditEngine.primary,    technicalLabel: SECTION_LABELS.auditEngine.technical,    to: '/dashboard',             Icon: Clock,       group: 'ENGINE' },
    // ── Library ────────────────────────────────────────────────────────────
    { label: SECTION_LABELS.tagLibrary.primary,     technicalLabel: SECTION_LABELS.tagLibrary.technical,     to: '/signals',               Icon: Tag,         group: 'LIBRARY' },
    ...(isBrand ? [] : [
      { label: 'Templates', to: `/org/${orgId}/packs`, Icon: LayoutGrid, group: 'LIBRARY' } as NavItemDef,
    ]),
    // ── Implementation ─────────────────────────────────────────────────────
    { label: SECTION_LABELS.conversionStrategyGate.primary,    technicalLabel: SECTION_LABELS.conversionStrategyGate.technical,    to: '/planning/strategy', Icon: Target, group: 'IMPLEMENTATION' },
    { label: SECTION_LABELS.platformConnections.primary,       technicalLabel: SECTION_LABELS.platformConnections.technical,       to: '/connections',       Icon: Link2,  group: 'IMPLEMENTATION' },
    // ── Tracking ───────────────────────────────────────────────────────────
    { label: SECTION_LABELS.signalTracking.primary, technicalLabel: SECTION_LABELS.signalTracking.technical, to: '/signal-tracking',                Icon: Activity,       group: 'TRACKING' },
    { label: SECTION_LABELS.reconciliation.primary, technicalLabel: SECTION_LABELS.reconciliation.technical, to: '/reconciliation',                 Icon: ArrowLeftRight, group: 'TRACKING' },
    { label: 'Implementation Health',                                                                        to: '/settings/implementation-health', Icon: HeartPulse,     group: 'TRACKING' },
    { label: SECTION_LABELS.signalHealth.primary,   technicalLabel: SECTION_LABELS.signalHealth.technical,   to: '/health',                         Icon: HeartPulse,     group: 'TRACKING' },
    // ── Advanced ───────────────────────────────────────────────────────────
    { label: 'Bid Signal Enricher',                 technicalLabel: 'bid_signal_enricher',                    to: '/integrations/enricher', Icon: Zap, group: 'ADVANCED' },
    // ── Privacy ────────────────────────────────────────────────────────────
    { label: SECTION_LABELS.consentHub.primary,      technicalLabel: SECTION_LABELS.consentHub.technical,      to: '/consent',           Icon: ShieldCheck, group: 'PRIVACY' },
    { label: SECTION_LABELS.capi.primary,            technicalLabel: SECTION_LABELS.capi.technical,            to: '/integrations/capi', Icon: Activity,    group: 'PRIVACY' },
    { label: SECTION_LABELS.channelInsights.primary, technicalLabel: SECTION_LABELS.channelInsights.technical, to: '/channels',          Icon: GitBranch,   group: 'PRIVACY' },
    // ── Trailing (rendered separately, not part of a collapsible group) ───
    { label: 'Team & Settings', to: `/org/${orgId}/settings`, Icon: Settings },
  ];
}

// ── Shared nav item styles ────────────────────────────────────────────────────
//
// Active-state treatment follows the console reference: a light navy tint +
// a 2px inset left accent bar, rather than a solid filled block — the one
// "colored left border" pattern this design system permits, reserved for
// this active-nav marker (and KPI stat cards, see StatCard).

const NAV_BASE =
  'group flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-heading font-medium transition-colors duration-100 w-full';

const NAV_ACTIVE =
  'bg-console-primary/[0.06] text-console-primary font-semibold shadow-[inset_2px_0_0_#1B2A4A]';

const NAV_INACTIVE =
  'text-console-fg-muted hover:bg-console-chip hover:text-console-fg';

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
              'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border font-mono text-[10px] font-bold mt-0.5 transition-colors',
              isActive
                ? 'border-console-primary text-console-primary bg-transparent'
                : done
                  ? 'border-console-green bg-console-green text-white'
                  : 'border-console-fg-disabled text-console-fg-subtle group-hover:border-console-fg group-hover:text-console-fg',
            )}>
              {done && !isActive ? '✓' : step}
            </span>
          ) : (
            <Icon
              className={cn(
                'h-[17px] w-[17px] shrink-0 mt-0.5',
                isActive ? 'text-console-primary' : 'text-console-fg-subtle group-hover:text-console-fg',
              )}
              strokeWidth={1.5}
            />
          )}
          <span className="flex flex-col min-w-0">
            <span className="leading-snug">{label}</span>
            {technicalLabel && (
              <span className={cn(
                'text-[11px] leading-tight font-sans font-normal truncate',
                isActive ? 'text-console-primary/60' : 'text-console-fg-subtle',
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

// ── CollapsibleNavGroup ───────────────────────────────────────────────────────

interface CollapsibleNavGroupProps {
  label: string;
  storageKey: string;
  children: ReactNode;
}

function CollapsibleNavGroup({ label, storageKey, children }: CollapsibleNavGroupProps) {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored === null ? true : stored === 'true';
    } catch {
      return true;
    }
  });

  function toggle() {
    setOpen((prev) => {
      const next = !prev;
      try { localStorage.setItem(storageKey, String(next)); } catch { /* quota exceeded */ }
      return next;
    });
  }

  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center justify-between px-3 pb-1 pt-3 group"
        aria-expanded={open}
      >
        <span className="font-heading text-[11px] font-semibold uppercase tracking-[0.12em] text-console-fg-subtle">
          {label}
        </span>
        {open
          ? <ChevronDown className="h-3 w-3 text-console-fg-subtle group-hover:text-console-fg transition-colors" />
          : <ChevronRight className="h-3 w-3 text-console-fg-subtle group-hover:text-console-fg transition-colors" />
        }
      </button>
      {open && <div className="space-y-0.5">{children}</div>}
    </div>
  );
}

// ── Create Org Dialog ─────────────────────────────────────────────────────────

function CreateOrgDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();

  function handleCreated(org: Organisation) {
    onOpenChange(false);
    if (org.org_type === 'brand' && org.primary_client_id) {
      navigate(`/clients/${org.primary_client_id}/tracking`);
    } else {
      navigate(`/org/${org.id}/clients`);
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
        <div className="pt-2">
          <CreateOrgForm onCreated={handleCreated} onCancel={() => onOpenChange(false)} />
        </div>
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
      className="flex h-full flex-col border-r border-console-border bg-console-surface"
      style={{ width: 240, minWidth: 240 }}
    >
      {/* ── Logo ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center border-b border-console-border px-5 pb-4 pt-5">
        <span className="font-display text-2xl font-black tracking-tighter text-console-primary">ATLAS</span>
      </div>

      {/* ── Workspace switcher ────────────────────────────────────────────── */}
      {organisations.length > 0 ? (
        <div className="px-4 pt-4">
          <OrgSwitcher />
        </div>
      ) : (
        <div className="px-4 pt-4">
          <button
            type="button"
            onClick={() => setCreateOrgOpen(true)}
            className="flex w-full items-center gap-2 rounded-md border border-dashed border-console-primary/30 bg-console-primary/[0.04] px-3 py-2.5 font-heading text-sm font-semibold text-console-primary hover:bg-console-primary/[0.08] transition-colors"
          >
            <Plus className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left">Create workspace</span>
          </button>
        </div>
      )}

      {/* ── Navigation ───────────────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto px-3 py-2">
        {activeOrgId ? (
          // Org context: grouped nav
          <>
            <div className="mb-1 space-y-0.5">
              <SidebarNavItem label="Home" to="/" Icon={Home} end />
            </div>
            <p className="font-heading px-3 pb-2 pt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-console-fg-subtle">
              {currentOrg?.name ?? 'Organisation'}
            </p>
            {(() => {
              const allOrgItems = orgNav(activeOrgId, currentOrg?.org_type, currentOrg?.primary_client_id);
              const teamItem = allOrgItems[allOrgItems.length - 1];
              const groupedItems = allOrgItems.filter(i => i !== teamItem);
              return (
                <>
                  {ORG_NAV_GROUPS.map(({ label, storageKey }) => {
                    const items = groupedItems.filter(i => i.group === label);
                    if (items.length === 0) return null;
                    return (
                      <CollapsibleNavGroup key={label} label={label} storageKey={storageKey}>
                        {items.map(item => <SidebarNavItem key={item.to} {...item} />)}
                      </CollapsibleNavGroup>
                    );
                  })}
                  <div className="space-y-0.5">
                    <SidebarNavItem {...teamItem} />
                  </div>
                </>
              );
            })()}
            {activeClientId && (
              <div className="mt-2 border-t border-console-border pt-2">
                <p className="font-heading px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-console-fg-subtle">This client</p>
                <SidebarNavItem
                  label="Set up tracking"
                  to={`/clients/${activeClientId}/tracking`}
                  Icon={MapPin}
                />
              </div>
            )}
            <div className="mt-3 border-t border-console-border pt-2">
              <SidebarNavItem label="Help" to="/help" Icon={HelpCircle} />
            </div>
          </>
        ) : (
          // Personal context: grouped nav
          <>
            {PERSONAL_NAV_GROUPS.map(({ label, items }) => (
              <CollapsibleNavGroup
                key={label}
                label={label}
                storageKey={`atlas.sidebar.personal.${label.toLowerCase().replace(/\s+/g, '-')}`}
              >
                {items.map((item) => (
                  <SidebarNavItem
                    key={item.to}
                    {...item}
                    done={item.stepKey ? completedSteps.includes(item.stepKey) : false}
                  />
                ))}
              </CollapsibleNavGroup>
            ))}
            {/* Settings & Help — standalone below divider */}
            <div className="mt-3 border-t border-console-border pt-2">
              <SidebarNavItem label="Help" to="/help" Icon={HelpCircle} />
              <SidebarNavItem label="Settings" to="/settings" Icon={Settings} />
            </div>
          </>
        )}
      </nav>

      {/* ── Admin section ─────────────────────────────────────────────────── */}
      {isAdmin && (
        <div className="border-t border-console-border px-3 py-3">
          <p className="font-heading px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-console-fg-subtle">Admin</p>
          <SidebarNavItem label="Platform Admin" to="/admin" Icon={ShieldAlert} />
        </div>
      )}

      {/* ── Status footer ────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-2 border-t border-console-border px-5 py-3.5">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-console-green opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-console-green" />
        </span>
        <span className="font-mono text-[11px] text-console-fg-subtle">All systems operational</span>
      </div>
    </aside>

    <CreateOrgDialog open={createOrgOpen} onOpenChange={setCreateOrgOpen} />
    </>
  );
}
