import { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Value rendering ───────────────────────────────────────────────────────────

function StringVal({ v }: { v: string }) {
  return <span className="text-[#16A34A]">&quot;{v}&quot;</span>;
}
function NumberVal({ v }: { v: number }) {
  return <span className="text-[#2563EB]">{v}</span>;
}
function BoolVal({ v }: { v: boolean }) {
  return <span className="text-[#D97706]">{String(v)}</span>;
}
function NullVal() {
  return <span className="text-[#9CA3AF] italic">null</span>;
}

// ── Recursive node ────────────────────────────────────────────────────────────

interface NodeProps {
  value: unknown;
  depth: number;
  label?: string;
}

function JsonNode({ value, depth, label }: NodeProps) {
  const [open, setOpen] = useState(depth < 2);

  const isObj   = value !== null && typeof value === 'object' && !Array.isArray(value);
  const isArr   = Array.isArray(value);
  const entries = isObj
    ? Object.entries(value as Record<string, unknown>)
    : isArr
      ? (value as unknown[]).map((v, i) => [String(i), v] as [string, unknown])
      : null;

  const indent = depth * 16;

  if (entries !== null) {
    const bracket = isArr ? ['[', ']'] : ['{', '}'];
    const count = entries.length;

    return (
      <div style={{ paddingLeft: depth === 0 ? 0 : indent }}>
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-0.5 text-[#374151] hover:text-[#1A1A1A] focus:outline-none"
          aria-expanded={open}
          aria-label={label ? `Toggle ${label}` : 'Toggle object'}
        >
          {open
            ? <ChevronDown className="h-3 w-3 shrink-0 text-[#9CA3AF]" />
            : <ChevronRight className="h-3 w-3 shrink-0 text-[#9CA3AF]" />}
          {label && (
            <span className="text-[#7C3AED] mr-1">&quot;{label}&quot;</span>
          )}
          {label && <span className="text-[#6B7280] mr-1">:</span>}
          <span className="text-[#6B7280]">
            {bracket[0]}
            {!open && <span className="text-[#9CA3AF] ml-0.5">{count} {isArr ? 'items' : 'keys'}</span>}
            {!open && bracket[1]}
          </span>
        </button>

        {open && (
          <div className="border-l border-[#E5E7EB] ml-1.5 pl-2 mt-0.5">
            {entries.map(([k, v]) => (
              <JsonNode key={k} value={v} depth={depth + 1} label={isArr ? undefined : k} />
            ))}
            <span className="text-[#6B7280]">{bracket[1]}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ paddingLeft: depth === 0 ? 0 : indent }} className="flex items-baseline gap-1 py-px">
      {label && <span className="text-[#7C3AED]">&quot;{label}&quot;</span>}
      {label && <span className="text-[#6B7280]">:</span>}
      {typeof value === 'string'  && <StringVal v={value} />}
      {typeof value === 'number'  && <NumberVal v={value} />}
      {typeof value === 'boolean' && <BoolVal v={value} />}
      {value === null             && <NullVal />}
    </div>
  );
}

// ── SignalPayloadViewer ───────────────────────────────────────────────────────

interface Props {
  title: string;
  data: Record<string, unknown> | null;
  defaultOpen?: boolean;
}

export function SignalPayloadViewer({ title, data, defaultOpen = true }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="rounded-lg border border-[#E5E7EB] bg-white overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-[#1A1A1A] hover:bg-[#F9FAFB] transition-colors"
        aria-expanded={open}
      >
        {title}
        {open
          ? <ChevronDown className="h-4 w-4 text-[#9CA3AF]" />
          : <ChevronRight className="h-4 w-4 text-[#9CA3AF]" />}
      </button>

      {open && (
        <div className="border-t border-[#F3F4F6] bg-[#F9FAFB] px-4 py-3 overflow-x-auto">
          {data === null ? (
            <p className="text-sm text-[#9CA3AF] italic">No data</p>
          ) : (
            <div className="font-mono text-xs leading-relaxed">
              <JsonNode value={data} depth={0} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
