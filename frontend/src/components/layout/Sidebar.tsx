import { NavLink } from 'react-router-dom';
import { Home, Map, Zap, Clock, Settings, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV = [
  { label: 'Home',          to: '/home',        Icon: Home },
  { label: 'Plan Tracking', to: '/planning',    Icon: Map },
  { label: 'New Audit',     to: '/journey/new', Icon: Zap },
  { label: 'History',       to: '/dashboard',   Icon: Clock },
  { label: 'Settings',      to: '/settings',    Icon: Settings },
];

export function Sidebar() {
  return (
    <aside className="flex h-full w-56 flex-col border-r bg-[hsl(220,9%,98%)] px-3 py-5">

      {/* Logo */}
      <div className="mb-6 flex items-center gap-2 px-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary shadow-sm">
          <TrendingUp className="h-4 w-4 text-primary-foreground" strokeWidth={2.5} />
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-[15px] font-bold tracking-tight text-foreground">Atlas</span>
          <span className="text-[10px] font-semibold uppercase tracking-widest text-primary">Signal</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-0.5">
        <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
          Workspace
        </p>
        {NAV.map(({ label, to, Icon }) => (
          <NavLink
            key={to}
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

      {/* Bottom — coming soon */}
      <div className="mt-auto">
        <div className="rounded-lg border border-dashed bg-background/60 px-3 py-3">
          <p className="text-xs font-semibold text-muted-foreground">Coming soon</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground/60">
            Monitoring · Benchmarks · Multi-property
          </p>
        </div>
      </div>

    </aside>
  );
}
