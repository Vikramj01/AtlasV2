import { useEffect } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import {
  Home, MapPin, CheckCircle, Clock, Settings,
  Building2, LayoutGrid, ShieldCheck, Activity,
  HeartPulse, ShieldAlert, GitBranch,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { OrgSwitcher } from '@/components/organisation/OrgSwitcher';
import { useOrganisationStore } from '@/store/organisationStore';
import { organisationApi } from '@/lib/api/organisationApi';

const PERSONAL_NAV = [
  { label: 'Signal Health',     to: '/health',            Icon: HeartPulse },
  { label: 'Home',              to: '/home',              Icon: Home },
  { label: 'Set Up Tracking',   to: '/planning',          Icon: MapPin },
  { label: 'Verify Journeys',   to: '/journey/new',       Icon: CheckCircle },
  { label: 'Audit History',     to: '/dashboard',         Icon: Clock },
  { label: 'Channel leak report',  to: '/channels',          Icon: GitBranch },
  { label: 'Conversion API',    to: '/integrations/capi', Icon: Activity },
  { label: 'Consent & Privacy', to: '/consent',           Icon: ShieldCheck },
  { label: 'Settings',          to: '/settings',          Icon: Settings },
];

function orgNav(orgId: string) {
  return [
    { label: 'Signal Health',     to: '/health',                Icon: HeartPulse },
    { label: 'Overview',          to: `/org/${orgId}`,          Icon: Home },
    { label: 'Clients',           to: `/org/${orgId}/clients`,  Icon: Building2 },
    { label: 'Tracking Map',      to: `/org/${orgId}/signals`,  Icon: MapPin },
    { label: 'Templates',         to: `/org/${orgId}/packs`,    Icon: LayoutGrid },
    { label: 'Set Up Tracking',   to: '/planning',              Icon: MapPin },
    { label: 'Audit History',     to: '/dashboard',             Icon: Clock },
    { label: 'Channel leak report',  to: '/channels',              Icon: GitBranch },
    { label: 'Conversion API',    to: '/integrations/capi',     Icon: Activity },
    { label: 'Consent & Privacy', to: '/consent',               Icon: ShieldCheck },
    { label: 'Team & Settings',   to: `/org/${orgId}/settings`, Icon: Settings },
  ];
}

// ── Shared nav item styles ────────────────────────────────────────────────────

const NAV_BASE =
  'group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-100 w-full';

const NAV_ACTIVE =
  'bg-[#1B2A4A] text-white';

const NAV_INACTIVE =
  'text-[#6B7280] hover:bg-[#F9FAFB] hover:text-[#1A1A1A]';

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
  const nav = activeOrgId ? orgNav(activeOrgId) : PERSONAL_NAV;

  return (
    <aside
      className="flex h-full flex-col border-r border-[#E5E7EB] bg-white"
      style={{ width: 240, minWidth: 240 }}
    >
      {/* ── Logo ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-[#E5E7EB]">
        <img
          src="/atlas_logo.svg"
          alt="Atlas logo"
          className="h-7 w-7 rounded-md object-contain shrink-0"
        />
        <span className="text-base font-semibold tracking-tight text-[#1B2A4A]">Atlas</span>
      </div>

      {/* ── Workspace switcher ────────────────────────────────────────────── */}
      {organisations.length > 0 && (
        <div className="px-3 pt-3">
          <OrgSwitcher />
        </div>
      )}

      {/* ── Navigation ───────────────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
        <p className="text-caption-upper px-3 pb-2 pt-1">
          {activeOrgId ? (currentOrg?.name ?? 'Organisation') : 'Workspace'}
        </p>

        {nav.map(({ label, to, Icon }) => (
          <NavLink
            key={`${to}-${label}`}
            to={to}
            className={({ isActive }) => cn(NAV_BASE, isActive ? NAV_ACTIVE : NAV_INACTIVE)}
          >
            {({ isActive }) => (
              <>
                <Icon
                  className={cn(
                    'h-5 w-5 shrink-0',
                    /* design spec: 20px icons, 1.5px stroke */
                    isActive ? 'text-white' : 'text-[#9CA3AF] group-hover:text-[#1A1A1A]',
                  )}
                  strokeWidth={1.5}
                />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* ── Admin section ─────────────────────────────────────────────────── */}
      {isAdmin && (
        <div className="border-t border-[#E5E7EB] px-3 py-3">
          <p className="text-caption-upper px-3 pb-2">Admin</p>
          <NavLink
            to="/admin"
            className={({ isActive }) => cn(NAV_BASE, isActive ? NAV_ACTIVE : NAV_INACTIVE)}
          >
            {({ isActive }) => (
              <>
                <ShieldAlert
                  className={cn(
                    'h-5 w-5 shrink-0',
                    isActive ? 'text-white' : 'text-[#9CA3AF] group-hover:text-[#1A1A1A]',
                  )}
                  strokeWidth={1.5}
                />
                Platform Admin
              </>
            )}
          </NavLink>
        </div>
      )}
    </aside>
  );
}
