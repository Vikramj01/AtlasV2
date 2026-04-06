/**
 * ErrorBoundary — React class-based error boundaries.
 *
 * Two variants:
 *
 *   AppErrorBoundary     — full-page fallback, used at the BrowserRouter root.
 *                          Catches any uncaught render error in the entire tree.
 *
 *   SectionErrorBoundary — compact inline card, used around individual pages/
 *                          features within the AppLayout. A page crash won't
 *                          take down the sidebar or navigation.
 *
 * Usage:
 *   <AppErrorBoundary>
 *     <BrowserRouter>…</BrowserRouter>
 *   </AppErrorBoundary>
 *
 *   <SectionErrorBoundary>
 *     <MyPage />
 *   </SectionErrorBoundary>
 */

import React from 'react';

const NAVY = '#1B2A4A';
const LIGHT_NAVY = '#EEF1F7';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

// ── AppErrorBoundary ──────────────────────────────────────────────────────────

/**
 * Full-page fallback for catastrophic render failures at the app root.
 */
export class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[Atlas] Uncaught render error:', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#F9FAFB',
          padding: 24,
          textAlign: 'center',
        }}
      >
        {/* Logo mark */}
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 10,
            backgroundColor: NAVY,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontSize: 22,
            fontWeight: 700,
            marginBottom: 24,
            letterSpacing: '-0.5px',
          }}
        >
          A
        </div>

        <h1
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: NAVY,
            margin: '0 0 8px',
          }}
        >
          Something went wrong
        </h1>

        <p
          style={{
            fontSize: 14,
            color: '#6B7280',
            maxWidth: 400,
            lineHeight: 1.6,
            margin: '0 0 24px',
          }}
        >
          Atlas encountered an unexpected error. This has been logged.
          Reloading the page usually fixes it.
        </p>

        {/* Error detail — only shown in dev */}
        {import.meta.env.DEV && this.state.error && (
          <pre
            style={{
              textAlign: 'left',
              background: '#FEF2F2',
              border: '1px solid #FECACA',
              borderRadius: 6,
              padding: '10px 14px',
              fontSize: 11,
              color: '#DC2626',
              maxWidth: 560,
              overflow: 'auto',
              marginBottom: 24,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {this.state.error.message}
          </pre>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => window.location.reload()}
            style={{
              backgroundColor: NAVY,
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '9px 20px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Reload page
          </button>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.href = '/health';
            }}
            style={{
              backgroundColor: LIGHT_NAVY,
              color: NAVY,
              border: `1px solid ${NAVY}30`,
              borderRadius: 6,
              padding: '9px 20px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Go to dashboard
          </button>
        </div>
      </div>
    );
  }
}

// ── SectionErrorBoundary ──────────────────────────────────────────────────────

interface SectionErrorBoundaryProps {
  children: React.ReactNode;
  /** Optional label shown in the error card (e.g. "Consent settings") */
  label?: string;
}

/**
 * Compact inline fallback for per-page / per-section crashes.
 * Shows an error card in place of the failed content; nav/sidebar stay intact.
 */
export class SectionErrorBoundary extends React.Component<
  SectionErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(
      `[Atlas] Section render error (${this.props.label ?? 'unknown'}):`,
      error,
      info.componentStack,
    );
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    const label = this.props.label ?? 'This section';

    return (
      <div
        style={{
          margin: 24,
          padding: '20px 24px',
          borderRadius: 8,
          border: '1px solid #FECACA',
          borderLeftWidth: 3,
          borderLeftColor: '#DC2626',
          backgroundColor: '#FEF2F2',
        }}
      >
        <p
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: '#DC2626',
            margin: '0 0 4px',
          }}
        >
          {label} failed to load
        </p>
        <p style={{ fontSize: 13, color: '#6B7280', margin: '0 0 14px' }}>
          An unexpected error occurred. Try refreshing or navigating away and back.
        </p>

        {import.meta.env.DEV && this.state.error && (
          <pre
            style={{
              fontSize: 11,
              color: '#DC2626',
              background: 'transparent',
              margin: '0 0 14px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {this.state.error.message}
          </pre>
        )}

        <button
          onClick={() => this.setState({ hasError: false, error: null })}
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: NAVY,
            background: LIGHT_NAVY,
            border: `1px solid ${NAVY}30`,
            borderRadius: 5,
            padding: '6px 14px',
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
      </div>
    );
  }
}
