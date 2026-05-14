import { useEffect } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  Home, MapPin, CheckCircle, Clock, Settings,
  Building2, LayoutGrid, ShieldCheck, Activity,
  HeartPulse, ShieldAlert, GitBranch, Tag,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { OrgSwitcher } from '@/components/organisation/OrgSwitcher';
import { useOrganisationStore } from '@/store/organisationStore';
import { organisationApi } from '@/lib/api/organisationApi';
import { SECTION_LABELS } from '@/lib/ui-copy';

// ── Nav data ──────────────────────────────────────────────────────────────────

type NavItemDef = { label: string; technicalLabel?: string; to: string; Icon: LucideIcon; end?: boolean };

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
      { label: SECTION_LABELS.planningMode.primary,   technicalLabel: SECTION_LABELS.planningMode.technical,   to: '/planning',          Icon: MapPin },
      { label: SECTION_LABELS.journeyBuilder.primary, technicalLabel: SECTION_LABELS.journeyBuilder.technical, to: '/journey/new',       Icon: CheckCircle },
      { label: SECTION_LABELS.tagLibrary.primary,    technicalLabel: SECTION_LABELS.tagLibrary.technical,    to: '/signals',           Icon: Tag },
      { label: SECTION_LABELS.consentHub.primary,     technicalLabel: SECTION_LABELS.consentHub.technical,     to: '/consent',           Icon: ShieldCheck },
      { label: SECTION_LABELS.capi.primary,           technicalLabel: SECTION_LABELS.capi.technical,           to: '/integrations/capi', Icon: Activity },
    ],
  },
  {
    label: 'MONITOR',
    items: [
      { label: SECTION_LABELS.signalHealth.primary,     technicalLabel: SECTION_LABELS.signalHealth.technical,     to: '/health',    Icon: HeartPulse },
      { label: SECTION_LABELS.auditEngine.primary,      technicalLabel: SECTION_LABELS.auditEngine.technical,      to: '/dashboard', Icon: Clock },
      { label: SECTION_LABELS.channelInsights.primary,  technicalLabel: SECTION_LABELS.channelInsights.technical,  to: '/channels',  Icon: GitBranch },
    ],
  },
];

function orgNav(orgId: string): NavItemDef[] {
  return [
    { label: 'Overview',                                                                                          to: `/org/${orgId}`,          Icon: Home },
    { label: 'Clients',                                                                                           to: `/org/${orgId}/clients`,  Icon: Building2 },
    { label: 'Tracking Map',                                                                                      to: `/org/${orgId}/signals`,  Icon: MapPin },
    { label: 'Templates',                                                                                         to: `/org/${orgId}/packs`,    Icon: LayoutGrid },
    { label: SECTION_LABELS.planningMode.primary,   technicalLabel: SECTION_LABELS.planningMode.technical,   to: '/planning',              Icon: MapPin },
    { label: SECTION_LABELS.auditEngine.primary,    technicalLabel: SECTION_LABELS.auditEngine.technical,    to: '/dashboard',             Icon: Clock },
    { label: SECTION_LABELS.channelInsights.primary,technicalLabel: SECTION_LABELS.channelInsights.technical,to: '/channels',              Icon: GitBranch },
    { label: SECTION_LABELS.capi.primary,           technicalLabel: SECTION_LABELS.capi.technical,           to: '/integrations/capi',     Icon: Activity },
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

function SidebarNavItem({ label, technicalLabel, to, Icon, end = false }: NavItemDef) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => cn(NAV_BASE, isActive ? NAV_ACTIVE : NAV_INACTIVE)}
    >
      {({ isActive }) => (
        <>
          <Icon
            className={cn(
              'h-5 w-5 shrink-0 mt-0.5',
              isActive ? 'text-white' : 'text-[#9CA3AF] group-hover:text-[#1A1A1A]',
            )}
            strokeWidth={1.5}
          />
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

// ── Component ─────────────────────────────────────────────────────────────────

export function Sidebar({ isAdmin = false }: { isAdmin?: boolean }) {
  const { currentOrg, organisations, setOrganisations } = useOrganisationStore();
  const params = useParams<{ orgId?: string }>();

  useEffect(() => {
    organisationApi.list()
      .then(setOrganisations)
      .catch(() => { /* non-blocking */ });
  }, [setOrganisations]);

  const activeOrgId = params.orgId ?? currentOrg?.id;

  return (
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
      {organisations.length > 0 && (
        <div className="px-3 pt-3">
          <OrgSwitcher />
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
              {orgNav(activeOrgId).map((item) => (
                <SidebarNavItem key={item.to} {...item} />
              ))}
            </div>
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
                    <SidebarNavItem key={item.to} {...item} />
                  ))}
                </div>
              </div>
            ))}
            {/* Settings — standalone below divider */}
            <div className="mt-3 border-t border-[#E5E7EB] pt-2">
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
  );
}
