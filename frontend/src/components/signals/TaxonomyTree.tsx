/**
 * TaxonomyTree
 *
 * Renders the event taxonomy as a collapsible tree.
 * Categories are collapsible rows; events show name, slug, funnel stage, platform
 * chips, and an "Add to Tracking Map" button.
 * Expanding an event row shows its parameter schema.
 */
import { useState } from 'react';
import { ChevronRight, ChevronDown, Plus, Check } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { signalApi } from '@/lib/api/signalApi';
import type { TaxonomyNode, FunnelStage } from '@/types/taxonomy';
import type { Signal } from '@/types/signal';

const PLATFORM_LABELS: Record<string, string> = {
  ga4: 'GA4',
  meta: 'Meta',
  google_ads: 'Google Ads',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  snapchat: 'Snapchat',
};

const FUNNEL_STAGE_STYLES: Record<FunnelStage, { bg: string; color: string }> = {
  awareness:     { bg: '#EFF6FF', color: '#3B82F6' },
  consideration: { bg: '#F5F3FF', color: '#7C3AED' },
  conversion:    { bg: '#F0FDF4', color: '#059669' },
  retention:     { bg: '#FFFBEB', color: '#D97706' },
  advocacy:      { bg: '#FDF4FF', color: '#A21CAF' },
};

function FunnelBadge({ stage }: { stage: FunnelStage | null }) {
  if (!stage) return null;
  const s = FUNNEL_STAGE_STYLES[stage];
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-medium shrink-0"
      style={{ backgroundColor: s.bg, color: s.color }}
    >
      {stage}
    </span>
  );
}

// ─── Event row ────────────────────────────────────────────────────────────────

interface EventRowProps {
  node: TaxonomyNode;
  depth: number;
  orgId: string;
  existingKeys: Set<string>;
  onAdded: (signal: Signal) => void;
}

function EventRow({ node, depth, orgId, existingKeys, onAdded }: EventRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const isAdded = existingKeys.has(node.slug);
  const platforms = node.platform_mappings ? Object.keys(node.platform_mappings) : [];
  const paddingLeft = depth * 16 + 12;

  const reqParams = node.parameter_schema?.required ?? [];
  const optParams = node.parameter_schema?.optional ?? [];
  const totalParams = reqParams.length + optParams.length;

  async function handleAdd() {
    if (isAdded || adding) return;
    setAdding(true);
    setAddError(null);
    try {
      const category =
        node.funnel_stage === 'conversion'
          ? 'conversion'
          : node.funnel_stage
            ? 'engagement'
            : 'custom';
      const signal = await signalApi.createSignal({
        organisation_id: orgId,
        key: node.slug,
        name: node.name,
        description: node.description ?? '',
        category,
        required_params: [],
        optional_params: [],
        taxonomy_event_id: node.id,
      } as Parameters<typeof signalApi.createSignal>[0]);
      onAdded(signal);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add');
    } finally {
      setAdding(false);
    }
  }

  return (
    <div>
      <div
        className="flex items-center gap-2 py-2 pr-3 hover:bg-[#F9FAFB] transition-colors"
        style={{ paddingLeft }}
      >
        {/* Expand params toggle */}
        <button
          type="button"
          className="text-[#D1D5DB] hover:text-[#9CA3AF] transition-colors shrink-0"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? 'Collapse params' : 'Expand params'}
        >
          {expanded
            ? <ChevronDown className="h-3 w-3" />
            : <ChevronRight className="h-3 w-3" />}
        </button>

        {/* Slug (mono) */}
        <code className="text-xs font-mono font-medium text-[#1B2A4A] truncate flex-1 min-w-0">
          {node.slug}
          {node.is_custom && (
            <span className="ml-1.5 text-[10px] font-sans text-[#9CA3AF]">(custom)</span>
          )}
        </code>

        {/* Human name (hidden on small screens) */}
        <span className="hidden sm:block text-xs text-[#6B7280] truncate max-w-[140px]">
          {node.name}
        </span>

        {/* Funnel stage (hidden on medium and below) */}
        <span className="hidden md:block">
          <FunnelBadge stage={node.funnel_stage} />
        </span>

        {/* Platform chips (hidden on small screens) */}
        <div className="hidden lg:flex items-center gap-1 shrink-0">
          {platforms.slice(0, 3).map((p) => (
            <span
              key={p}
              className="rounded bg-[#F3F4F6] px-1.5 py-0.5 text-[10px] text-[#6B7280]"
            >
              {PLATFORM_LABELS[p] ?? p}
            </span>
          ))}
          {platforms.length > 3 && (
            <span className="text-[10px] text-[#9CA3AF]">+{platforms.length - 3}</span>
          )}
        </div>

        {/* Add to Tracking Map */}
        <Button
          size="sm"
          variant={isAdded ? 'secondary' : 'outline'}
          className="h-6 text-[10px] px-2 gap-1 shrink-0"
          disabled={isAdded || adding}
          onClick={handleAdd}
          title={isAdded ? 'Already in Tracking Map' : 'Add to Tracking Map'}
        >
          {isAdded
            ? <><Check className="h-3 w-3" /> Added</>
            : adding
              ? '…'
              : <><Plus className="h-3 w-3" /> Add</>}
        </Button>
      </div>

      {/* Inline error */}
      {addError && (
        <p
          className="text-[10px] text-red-600 pb-1"
          style={{ paddingLeft: paddingLeft + 20 }}
        >
          {addError}
        </p>
      )}

      {/* Expanded parameter details */}
      {expanded && totalParams > 0 && (
        <div
          className="bg-[#FAFAFA] border-t border-[#F3F4F6] py-2"
          style={{ paddingLeft: paddingLeft + 20, paddingRight: 12 }}
        >
          {reqParams.length > 0 && (
            <div className="mb-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF] mb-1">
                Required
              </p>
              <div className="flex flex-wrap gap-1">
                {reqParams.map((p) => (
                  <span
                    key={p.key}
                    className="rounded border border-[#E5E7EB] bg-white px-1.5 py-0.5 text-[10px] font-mono"
                    title={p.description}
                  >
                    {p.key}
                    <span className="ml-1 text-[#9CA3AF]">{p.type}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          {optParams.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF] mb-1">
                Optional
              </p>
              <div className="flex flex-wrap gap-1">
                {optParams.map((p) => (
                  <span
                    key={p.key}
                    className="rounded border border-dashed border-[#E5E7EB] bg-white px-1.5 py-0.5 text-[10px] font-mono text-[#6B7280]"
                    title={p.description}
                  >
                    {p.key}
                    <span className="ml-1 text-[#9CA3AF]">{p.type}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Category row (recursive) ─────────────────────────────────────────────────

interface CategoryRowProps {
  node: TaxonomyNode;
  depth: number;
  orgId: string;
  existingKeys: Set<string>;
  onAdded: (signal: Signal) => void;
}

function CategoryRow({ node, depth, orgId, existingKeys, onAdded }: CategoryRowProps) {
  const [open, setOpen] = useState(depth === 0);
  const children = node.children ?? [];
  const eventCount = countEvents(node);
  const paddingLeft = depth * 16 + 8;

  return (
    <div>
      <button
        type="button"
        className="w-full flex items-center gap-2 py-2.5 pr-3 hover:bg-[#F3F4F6] transition-colors"
        style={{ paddingLeft }}
        onClick={() => setOpen((v) => !v)}
      >
        {open
          ? <ChevronDown className="h-3.5 w-3.5 text-[#9CA3AF] shrink-0" />
          : <ChevronRight className="h-3.5 w-3.5 text-[#9CA3AF] shrink-0" />}
        {node.icon && <span className="text-sm leading-none">{node.icon}</span>}
        <span className="text-xs font-semibold text-[#1B2A4A]">{node.name}</span>
        <span className="text-[10px] text-[#9CA3AF]">({eventCount})</span>
        {node.is_custom && (
          <Badge variant="secondary" className="text-[10px] ml-0.5 py-0">custom</Badge>
        )}
      </button>

      {open && children.length > 0 && (
        <div className="border-l border-[#F3F4F6] ml-4">
          {children.map((child) =>
            child.node_type === 'category' ? (
              <CategoryRow
                key={child.id}
                node={child}
                depth={depth + 1}
                orgId={orgId}
                existingKeys={existingKeys}
                onAdded={onAdded}
              />
            ) : (
              <EventRow
                key={child.id}
                node={child}
                depth={depth + 1}
                orgId={orgId}
                existingKeys={existingKeys}
                onAdded={onAdded}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function countEvents(node: TaxonomyNode): number {
  if (node.node_type === 'event') return 1;
  return (node.children ?? []).reduce((sum, child) => sum + countEvents(child), 0);
}

// Recursive filter: keeps only event nodes (and their parent categories) matching q
function filterTree(nodes: TaxonomyNode[], q: string): TaxonomyNode[] {
  const results: TaxonomyNode[] = [];
  for (const node of nodes) {
    if (node.node_type === 'event') {
      const match =
        node.slug.toLowerCase().includes(q) ||
        node.name.toLowerCase().includes(q) ||
        (node.description ?? '').toLowerCase().includes(q);
      if (match) results.push(node);
    } else {
      const filteredChildren = filterTree(node.children ?? [], q);
      if (filteredChildren.length > 0) {
        results.push({ ...node, children: filteredChildren });
      }
    }
  }
  return results;
}

// ─── Public component ─────────────────────────────────────────────────────────

export interface TaxonomyTreeProps {
  orgId: string;
  tree: TaxonomyNode[];
  isLoading: boolean;
  /** Keys of signals already in the org's Tracking Map, for "Added" state */
  existingSignalKeys?: string[];
  onAdded: (signal: Signal) => void;
  onCreateCustom?: () => void;
}

export function TaxonomyTree({
  orgId,
  tree,
  isLoading,
  existingSignalKeys = [],
  onAdded,
  onCreateCustom,
}: TaxonomyTreeProps) {
  const [search, setSearch] = useState('');
  const keySet = new Set(existingSignalKeys);
  const q = search.trim().toLowerCase();
  const displayTree = q ? filterTree(tree, q) : tree;

  if (isLoading) {
    return (
      <div className="rounded-lg border border-[#E5E7EB] overflow-hidden">
        <div className="flex items-center gap-2 border-b border-[#E5E7EB] px-3 py-2">
          <div className="h-4 w-32 animate-pulse rounded bg-[#F3F4F6]" />
        </div>
        <div className="divide-y divide-[#F3F4F6] p-2 space-y-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-8 animate-pulse rounded bg-[#F3F4F6]" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[#E5E7EB] overflow-hidden">
      {/* Search + custom event button */}
      <div className="flex items-center gap-2 border-b border-[#E5E7EB] bg-[#FAFAFA] px-3 py-2">
        <input
          type="text"
          placeholder="Search events…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 text-xs bg-transparent outline-none placeholder:text-[#9CA3AF] text-[#1B2A4A]"
        />
        {onCreateCustom && (
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-[#1B2A4A] font-medium hover:underline shrink-0"
            onClick={onCreateCustom}
          >
            <Plus className="h-3 w-3" />
            Custom event
          </button>
        )}
      </div>

      {/* Tree */}
      <div className="divide-y divide-[#F3F4F6]">
        {displayTree.map((node) =>
          node.node_type === 'category' ? (
            <CategoryRow
              key={node.id}
              node={node}
              depth={0}
              orgId={orgId}
              existingKeys={keySet}
              onAdded={onAdded}
            />
          ) : (
            <EventRow
              key={node.id}
              node={node}
              depth={0}
              orgId={orgId}
              existingKeys={keySet}
              onAdded={onAdded}
            />
          ),
        )}

        {displayTree.length === 0 && (
          <p className="py-10 text-center text-sm text-[#9CA3AF]">
            {q ? 'No events match your search' : 'No events in taxonomy'}
          </p>
        )}
      </div>
    </div>
  );
}
