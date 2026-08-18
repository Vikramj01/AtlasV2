/**
 * OrgSwitcher — Workspace switcher in the sidebar.
 * Shows current context (Personal or Org name) with a dropdown to switch.
 */

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Building2, ChevronDown, User, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useOrganisationStore } from '@/store/organisationStore';

interface Props {
  /** Called after user selects an org to navigate to it. */
  onSwitch?: () => void;
}

export function OrgSwitcher({ onSwitch }: Props) {
  const navigate = useNavigate();
  const { currentOrg, organisations, setCurrentOrg } = useOrganisationStore();
  const [open, setOpen] = useState(false);

  const label = currentOrg?.name ?? 'Personal';
  const initial = (currentOrg?.name?.trim()[0] ?? 'P').toUpperCase();

  function handleSelect(org: typeof currentOrg) {
    setCurrentOrg(org);
    setOpen(false);
    if (org) {
      navigate(`/org/${org.id}`);
    } else {
      navigate('/home');
    }
    onSwitch?.();
  }

  return (
    <div className="relative mb-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-md border border-console-border bg-console-surface px-3 py-2.5 font-heading text-sm font-semibold text-console-fg hover:bg-console-chip transition-colors"
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-console-primary font-mono text-[10px] font-bold text-white">
          {initial}
        </span>
        <span className="flex-1 truncate text-left">{label}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-console-fg-subtle transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute top-full z-50 mt-1 w-full rounded-lg border bg-popover shadow-lg">
          {/* Personal workspace */}
          <button
            type="button"
            onClick={() => handleSelect(null)}
            className={cn(
              'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent rounded-t-lg',
              !currentOrg && 'bg-primary/10 text-primary font-medium',
            )}
          >
            <User className="h-3.5 w-3.5 shrink-0" />
            Personal
          </button>

          {organisations.length > 0 && <div className="mx-3 my-1 border-t" />}

          {/* Org workspaces */}
          {organisations.map((org) => (
            <button
              key={org.id}
              type="button"
              onClick={() => handleSelect(org)}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent',
                currentOrg?.id === org.id && 'bg-primary/10 text-primary font-medium',
              )}
            >
              <Building2 className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{org.name}</span>
            </button>
          ))}

          {/* Create org */}
          <div className="mx-3 my-1 border-t" />
          <Link
            to="/settings?tab=org"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2 rounded-b-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            New organisation
          </Link>
        </div>
      )}
    </div>
  );
}
