import { useEffect } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { Home, Map, Zap, Clock, Settings, TrendingUp, Building2, Package, Shield, Activity, HeartPulse } from 'lucide-react';
import { cn } from '@/lib/utils';
import { OrgSwitcher } from '@/components/organisation/OrgSwitcher';
import { useOrganisationStore } from '@/store/organisationStore';
import { organisationApi } from '@/lib/api/organisationApi';

const PERSONAL_NAV = [
  { label: 'Data Health',   to: '/health',             Icon: HeartPulse },
  { label: 'Home',          to: '/home',               Icon: Home },
  { label: 'Plan Tracking', to: '/planning',           Icon: Map },
  { label: 'New Audit',     to: '/journey/new',        Icon: Zap },
  { label: 'History',       to: '/dashboard',          Icon: Clock },
  { label: 'CAPI',          to: '/integrations/capi',  Icon: Activity },
  { label: 'Consent',       to: '/consent',            Icon: Shield },
  { label: 'Settings',      to: '/settings',           Icon: Settings },
];

function orgNav(orgId: string) {
  return [
    { label: 'Data Health',     to: '/health',                 Icon: HeartPulse },
    { label: 'Overview',        to: `/org/${orgId}`,           Icon: Home },
    { label: 'Clients',         to: `/org/${orgId}/clients`,   Icon: Building2 },
    { label: 'Signal Library',  to: `/org/${orgId}/signals`,   Icon: Zap },
    { label: 'Signal Packs',    to: `/org/${orgId}/packs`,     Icon: Package },
    { label: 'Plan Tracking',   to: '/planning',               Icon: Map },
    { label: 'History',         to: '/dashboard',              Icon: Clock },
    { label: 'CAPI',            to: '/integrations/capi',      Icon: Activity },
    { label: 'Consent',         to: '/consent',                Icon: Shield },
    { label: 'Team & Settings', to: `/org/${orgId}/settings`,  Icon: Settings },
  ];
}

export function Sidebar() {
  const { currentOrg, organisations, setOrganisations } = useOrganisationStore();
  const params = useParams<{ orgId?: string }>();

  // Load user's organisations once
  useEffect(() => {
    organisationApi.list()
      .then(setOrganisations)
      .catch(() => { /* not blocking */ });
  }, [setOrganisations]);

  // If we're on an org route, use org nav; otherwise personal nav
  const activeOrgId = params.orgId ?? currentOrg?.id;
  const nav = activeOrgId ? orgNav(activeOrgId) : PERSONAL_NAV;

  return (
    <aside className="flex h-full w-56 flex-col border-r bg-[hsl(220,9%,98%)] px-3 py-5">

      {/* Logo */}
      <div className="mb-4 flex items-center gap-2 px-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary shadow-sm">
          <TrendingUp className="h-4 w-4 text-primary-foreground" strokeWidth={2.5} />
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-[15px] font-bold tracking-tight text-foreground">Atlas</span>
          <span className="text-[10px] font-semibold uppercase tracking-widest text-primary">Signal</span>
        </div>
      </div>

      {/* Workspace switcher — only show if user has orgs */}
      {organisations.length > 0 && (
        <OrgSwitcher />
      )}

      {/* Nav */}
      <nav className="flex flex-col gap-0.5">
        <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
          {activeOrgId ? (currentOrg?.name ?? 'Organisation') : 'Workspace'}
        </p>
        {nav.map(({ label, to, Icon }) => (
          <NavLink
            key={`${to}-${label}`}
            to={to}
            className={({ isActive }) =>
              cn(
                'group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150',
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  className={cn(
                    'h-4 w-4 shrink-0 transition-colors',
                    isActive ? 'text-primary' : 'text-muted-foreground/70 group-hover:text-foreground'
                  )}
                  strokeWidth={isActive ? 2.5 : 2}
                />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>


    </aside>
  );
}
