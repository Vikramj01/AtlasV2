/**
 * BannerPreview
 *
 * Pure display component — no hooks needed.
 * Renders a live preview of the consent banner inside a 16:9 preview box.
 * Reflects position, colours, and copy from the BannerConfig prop.
 */

import type { BannerConfig } from '@/types/consent';

interface BannerPreviewProps {
  config: BannerConfig;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function LogoImg({ url }: { url: string | null }) {
  if (!url) return null;
  return (
    <img
      src={url}
      alt="Logo"
      style={{ maxHeight: 28, maxWidth: 80, objectFit: 'contain', flexShrink: 0 }}
    />
  );
}

function PreviewButton({
  label,
  bg,
  color,
  small = false,
}: {
  label: string;
  bg: string;
  color: string;
  small?: boolean;
}) {
  return (
    <span
      style={{
        background: bg,
        color,
        padding: small ? '3px 10px' : '4px 12px',
        borderRadius: 4,
        fontSize: small ? 9 : 10,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        display: 'inline-block',
        cursor: 'default',
      }}
    >
      {label}
    </span>
  );
}

function BottomBar({ config }: { config: BannerConfig }) {
  const { colors, copy, logo_url } = config;
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        background: colors.background,
        color: colors.text,
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
        boxShadow: '0 -2px 8px rgba(0,0,0,0.10)',
      }}
    >
      <LogoImg url={logo_url} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 10, fontWeight: 700, margin: 0 }}>{copy.heading}</p>
        <p
          style={{
            fontSize: 8.5,
            margin: '2px 0 0',
            opacity: 0.8,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {copy.body}
        </p>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
        <span style={{ fontSize: 8, textDecoration: 'underline', cursor: 'default', color: colors.text }}>
          {copy.manage_link}
        </span>
        <PreviewButton label={copy.reject_button} bg={colors.button_secondary} color={colors.text} small />
        <PreviewButton label={copy.accept_button} bg={colors.button_primary} color={colors.background} small />
      </div>
    </div>
  );
}

function Modal({ config }: { config: BannerConfig }) {
  const { colors, copy, logo_url } = config;
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          background: colors.background,
          color: colors.text,
          borderRadius: 8,
          padding: 20,
          width: '60%',
          maxWidth: 280,
          boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        }}
      >
        {logo_url && (
          <div style={{ marginBottom: 10 }}>
            <LogoImg url={logo_url} />
          </div>
        )}
        <p style={{ fontSize: 12, fontWeight: 700, margin: '0 0 6px' }}>{copy.heading}</p>
        <p style={{ fontSize: 9, margin: '0 0 14px', opacity: 0.8, lineHeight: 1.4 }}>{copy.body}</p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <PreviewButton label={copy.accept_button} bg={colors.button_primary} color={colors.background} />
          <PreviewButton label={copy.reject_button} bg={colors.button_secondary} color={colors.text} />
        </div>
        <p style={{ fontSize: 8, marginTop: 10, textDecoration: 'underline', cursor: 'default', opacity: 0.7 }}>
          {copy.manage_link}
        </p>
      </div>
    </div>
  );
}

function CornerWidget({ config }: { config: BannerConfig }) {
  const { colors, copy, logo_url } = config;
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 12,
        right: 12,
        background: colors.background,
        color: colors.text,
        borderRadius: 8,
        padding: 12,
        width: 160,
        boxShadow: '0 4px 16px rgba(0,0,0,0.14)',
      }}
    >
      {logo_url && (
        <div style={{ marginBottom: 6 }}>
          <LogoImg url={logo_url} />
        </div>
      )}
      <p style={{ fontSize: 10, fontWeight: 700, margin: '0 0 4px' }}>{copy.heading}</p>
      <p style={{ fontSize: 8, margin: '0 0 10px', opacity: 0.8, lineHeight: 1.3 }}>
        {copy.body.length > 80 ? `${copy.body.slice(0, 80)}\u2026` : copy.body}
      </p>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        <PreviewButton label={copy.accept_button} bg={colors.button_primary} color={colors.background} small />
        <PreviewButton label={copy.reject_button} bg={colors.button_secondary} color={colors.text} small />
      </div>
      <p style={{ fontSize: 7.5, marginTop: 6, textDecoration: 'underline', cursor: 'default', opacity: 0.7 }}>
        {copy.manage_link}
      </p>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function BannerPreview({ config }: BannerPreviewProps) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">
        Preview
      </p>
      {/* 16:9 preview box */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 480,
          aspectRatio: '16 / 9',
          background: '#f3f4f6',
          borderRadius: 8,
          overflow: 'hidden',
          border: '1px solid #e5e7eb',
        }}
      >
        {/* Mock page content lines */}
        <div style={{ padding: 16, opacity: 0.25 }}>
          <div style={{ height: 10, width: '60%', background: '#d1d5db', borderRadius: 4, marginBottom: 8 }} />
          <div style={{ height: 6, width: '90%', background: '#d1d5db', borderRadius: 4, marginBottom: 5 }} />
          <div style={{ height: 6, width: '75%', background: '#d1d5db', borderRadius: 4, marginBottom: 5 }} />
          <div style={{ height: 6, width: '80%', background: '#d1d5db', borderRadius: 4 }} />
        </div>

        {/* Banner overlay */}
        {config.position === 'bottom_bar' && <BottomBar config={config} />}
        {config.position === 'modal'      && <Modal config={config} />}
        {config.position === 'corner'     && <CornerWidget config={config} />}
      </div>
    </div>
  );
}
