/**
 * SignalToPlatformPreview
 *
 * Shows the full platform mapping for a single Signal — event names,
 * parameter mappings, and WalkerOS config.
 *
 * Used as an expandable section on SignalCard or as modal content on
 * SignalLibraryPage when a user wants to see exactly how a signal is
 * translated before deploying it.
 *
 * Sprint 2 — Signal Library
 */

import { useState } from 'react';
import type { Signal, PlatformEventMapping, WalkerOSMapping } from '@/types/signal';

// ── Constants ─────────────────────────────────────────────────────────────────

const PLATFORM_META: Record<string, { label: string; color: string }> = {
  ga4:        { label: 'GA4',        color: 'bg-orange-50 text-orange-700 border-orange-200' },
  meta:       { label: 'Meta',       color: 'bg-blue-50 text-blue-700 border-blue-200' },
  google_ads: { label: 'Google Ads', color: 'bg-green-50 text-green-700 border-green-200' },
  tiktok:     { label: 'TikTok',     color: 'bg-pink-50 text-pink-700 border-pink-200' },
  linkedin:   { label: 'LinkedIn',   color: 'bg-sky-50 text-sky-700 border-sky-200' },
  snapchat:   { label: 'Snapchat',   color: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
};

// ── Sub-components ────────────────────────────────────────────────────────────

function ParamTable({ mapping }: { mapping: Record<string, string> }) {
  const entries = Object.entries(mapping);
  if (entries.length === 0) return null;
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b">
          <th className="pb-1 pr-4 text-left font-medium text-muted-foreground">Atlas param</th>
          <th className="pb-1 text-left font-medium text-muted-foreground">→ Platform param</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([atlasKey, platformParam]) => (
          <tr key={atlasKey} className="border-b last:border-0">
            <td className="py-1 pr-4 font-mono text-foreground">{atlasKey}</td>
            <td className="py-1 font-mono text-muted-foreground">{platformParam}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PlatformSection({ name, mapping }: { name: string; mapping: PlatformEventMapping }) {
  const meta = PLATFORM_META[name] ?? { label: name, color: 'bg-muted text-muted-foreground border-muted' };
  const additionalEntries = Object.entries(mapping.additional ?? {});

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${meta.color}`}>
          {meta.label}
        </span>
        <code className="text-xs text-muted-foreground">event: <span className="text-foreground font-medium">{mapping.event_name}</span></code>
      </div>

      {Object.keys(mapping.param_mapping).length > 0 && (
        <div className="pl-2 border-l-2 border-muted">
          <ParamTable mapping={mapping.param_mapping} />
        </div>
      )}

      {additionalEntries.length > 0 && (
        <div className="pl-2 border-l-2 border-muted">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Additional</p>
          <table className="w-full text-xs">
            <tbody>
              {additionalEntries.map(([k, v]) => (
                <tr key={k} className="border-b last:border-0">
                  <td className="py-1 pr-4 font-mono">{k}</td>
                  <td className="py-1 font-mono text-muted-foreground">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function WalkerOSSection({ mapping }: { mapping: WalkerOSMapping }) {
  const dataEntries = Object.entries(mapping.data_mapping);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="rounded border px-2 py-0.5 text-xs font-semibold bg-violet-50 text-violet-700 border-violet-200">
          WalkerOS
        </span>
        <code className="text-xs text-muted-foreground">
          <span className="text-foreground font-medium">{mapping.entity}</span>
          {' '}
          <span className="text-muted-foreground">·</span>
          {' '}
          <span className="text-foreground font-medium">{mapping.action}</span>
        </code>
      </div>

      <div className="pl-2 border-l-2 border-muted space-y-2">
        {/* Trigger */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground font-medium">Trigger:</span>
          <code className="font-mono">{mapping.trigger.type}</code>
          {mapping.trigger.selector && (
            <code className="font-mono text-muted-foreground">{mapping.trigger.selector}</code>
          )}
        </div>

        {/* Data mapping */}
        {dataEntries.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Data mapping</p>
            <ParamTable mapping={mapping.data_mapping} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

type ActiveTab = string | 'walkeros';

interface Props {
  signal: Signal;
  /** If true, renders as an inline panel with a toggle button (for SignalCard use). Default: false (standalone). */
  collapsible?: boolean;
}

export function SignalToPlatformPreview({ signal, collapsible = false }: Props) {
  const platformKeys = Object.keys(signal.platform_mappings ?? {});
  const hasWalkerOS = !!signal.walkeros_mapping;
  const allTabs: ActiveTab[] = [...platformKeys, ...(hasWalkerOS ? ['walkeros'] : [])];

  const [active, setActive] = useState<ActiveTab>(allTabs[0] ?? '');
  const [open, setOpen] = useState(!collapsible);

  if (allTabs.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">
        No platform mappings defined for this signal yet.
      </p>
    );
  }

  if (collapsible && !open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        Show platform mappings ▾
      </button>
    );
  }

  return (
    <div className="space-y-3">
      {/* Toggle button (collapsible mode only) */}
      {collapsible && (
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Hide platform mappings ▲
        </button>
      )}

      {/* Tab bar */}
      <div className="flex flex-wrap gap-1">
        {platformKeys.map((p) => {
          const meta = PLATFORM_META[p] ?? { label: p, color: '' };
          return (
            <button
              key={p}
              type="button"
              onClick={() => setActive(p)}
              className={`rounded border px-2.5 py-1 text-xs font-medium transition-colors ${
                active === p
                  ? (meta.color || 'bg-muted text-foreground border-muted-foreground')
                  : 'border-muted bg-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {meta.label}
            </button>
          );
        })}
        {hasWalkerOS && (
          <button
            type="button"
            onClick={() => setActive('walkeros')}
            className={`rounded border px-2.5 py-1 text-xs font-medium transition-colors ${
              active === 'walkeros'
                ? 'bg-violet-50 text-violet-700 border-violet-200'
                : 'border-muted bg-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            WalkerOS
          </button>
        )}
      </div>

      {/* Tab content */}
      <div className="rounded-lg border bg-muted/20 p-3">
        {active !== 'walkeros' && signal.platform_mappings[active] && (
          <PlatformSection name={active} mapping={signal.platform_mappings[active]} />
        )}
        {active === 'walkeros' && signal.walkeros_mapping && (
          <WalkerOSSection mapping={signal.walkeros_mapping} />
        )}
      </div>
    </div>
  );
}
