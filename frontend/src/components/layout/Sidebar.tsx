import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';

const NAV = [
  { label: 'Plan Tracking', to: '/planning',    icon: '◎' },
  { label: 'New Audit',     to: '/journey/new', icon: '✦' },
  { label: 'History',       to: '/dashboard',   icon: '◈' },
  { label: 'Settings',      to: '/settings',    icon: '⚙' },
];

export function Sidebar() {
  return (
    <aside className="flex h-full w-56 flex-col border-r bg-background px-3 py-6">
      {/* Logo */}
      <div className="mb-6 px-3">
        <span className="text-xl font-bold tracking-tight">Atlas</span>
        <span className="ml-1 text-xs font-medium text-brand-500">Signal</span>
      </div>

      <Separator className="mb-4" />

      {/* Nav */}
      <nav className="flex flex-col gap-0.5">
        {NAV.map(({ label, to, icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )
            }
          >
            <span className="text-base leading-none" aria-hidden="true">{icon}</span>
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Future: monitoring, benchmarks, multi-property */}
      <div className="mt-auto">
        <div className="rounded-lg border border-dashed px-3 py-3">
          <p className="text-xs font-medium text-muted-foreground">Coming soon</p>
          <p className="mt-0.5 text-xs text-muted-foreground/70">Monitoring · Benchmarks · Multi-property</p>
        </div>
      </div>
    </aside>
  );
}
