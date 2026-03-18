/**
 * EducationTooltip — "Why this matters" contextual tooltip.
 *
 * Wraps any trigger element and shows an educational popover on hover/focus.
 * Content is pulled from the tooltipContent dictionary by key.
 *
 * Usage:
 *   <EducationTooltip contentKey="capi.why_server_side">
 *     <InfoIcon />
 *   </EducationTooltip>
 *
 *   <EducationTooltip contentKey="planning.purchase" inline>
 *     <span>Purchase event</span>
 *   </EducationTooltip>
 */

import { useState, useRef, useEffect } from 'react';
import { HelpCircle, TrendingUp } from 'lucide-react';
import TOOLTIP_CONTENT from '@/lib/tooltipContent';

interface EducationTooltipProps {
  contentKey: string;
  children?: React.ReactNode;
  /** If true, renders an inline info icon next to children instead of wrapping */
  showIcon?: boolean;
  /** Position preference (default: top) */
  position?: 'top' | 'bottom' | 'left' | 'right';
}

export function EducationTooltip({
  contentKey,
  children,
  showIcon = false,
  position = 'top',
}: EducationTooltipProps) {
  const content = TOOLTIP_CONTENT[contentKey];
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Don't render if no content for this key
  if (!content) {
    return <>{children}</>;
  }

  function show() {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const scrollY = window.scrollY;
    const scrollX = window.scrollX;
    // Default: position above trigger
    setCoords({
      top: rect.top + scrollY - 8,
      left: rect.left + scrollX + rect.width / 2,
    });
    setVisible(true);
  }

  function hide() { setVisible(false); }

  // Close on outside click
  useEffect(() => {
    if (!visible) return;
    function handleClick(e: MouseEvent) {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target as Node) &&
        tooltipRef.current && !tooltipRef.current.contains(e.target as Node)
      ) {
        hide();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [visible]);

  return (
    <>
      <span
        ref={triggerRef}
        className="inline-flex items-center gap-1 cursor-help"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        tabIndex={0}
        role="button"
        aria-label={`Learn more: ${content.title}`}
      >
        {children}
        {showIcon && (
          <HelpCircle className="h-3.5 w-3.5 text-muted-foreground/60 hover:text-muted-foreground transition-colors" />
        )}
      </span>

      {visible && (
        <TooltipPopover
          ref={tooltipRef}
          content={content}
          coords={coords}
          position={position}
        />
      )}
    </>
  );
}

// ── Standalone info icon (convenience wrapper) ────────────────────────────────

export function InfoTooltip({
  contentKey,
  className = '',
}: {
  contentKey: string;
  className?: string;
}) {
  return (
    <EducationTooltip contentKey={contentKey} showIcon={false}>
      <HelpCircle className={`h-3.5 w-3.5 text-muted-foreground/60 hover:text-muted-foreground transition-colors ${className}`} />
    </EducationTooltip>
  );
}

// ── Tooltip popover ───────────────────────────────────────────────────────────

import React from 'react';
import { createPortal } from 'react-dom';

const TooltipPopover = React.forwardRef<
  HTMLDivElement,
  {
    content: (typeof TOOLTIP_CONTENT)[string];
    coords: { top: number; left: number };
    position: 'top' | 'bottom' | 'left' | 'right';
  }
>(({ content, coords, position }, ref) => {
  const TOOLTIP_W = 280;

  const style: React.CSSProperties = {
    position: 'absolute',
    zIndex: 9999,
    width: TOOLTIP_W,
    // Center horizontally on trigger; offset above
    left: Math.max(8, coords.left - TOOLTIP_W / 2),
    top: position === 'bottom' ? coords.top + 28 : coords.top - 8,
    transform: position === 'bottom' ? 'none' : 'translateY(-100%)',
  };

  return createPortal(
    <div
      ref={ref}
      style={style}
      className="rounded-xl border bg-popover shadow-lg px-4 py-3.5 text-popover-foreground pointer-events-none"
      role="tooltip"
    >
      <p className="text-xs font-semibold mb-1.5">{content.title}</p>
      <p className="text-xs leading-relaxed text-muted-foreground">{content.body}</p>
      {content.stat && (
        <div className="mt-2.5 flex items-start gap-1.5 rounded-lg bg-primary/5 border border-primary/10 px-2.5 py-2">
          <TrendingUp className="h-3.5 w-3.5 shrink-0 text-primary mt-0.5" />
          <p className="text-[11px] font-medium text-primary leading-snug">{content.stat}</p>
        </div>
      )}
      {/* Arrow */}
      {position !== 'bottom' && (
        <div
          className="absolute left-1/2 bottom-0 -translate-x-1/2 translate-y-full w-0 h-0"
          style={{
            borderLeft: '6px solid transparent',
            borderRight: '6px solid transparent',
            borderTop: '6px solid hsl(var(--border))',
          }}
        />
      )}
    </div>,
    document.body
  );
});
TooltipPopover.displayName = 'TooltipPopover';
