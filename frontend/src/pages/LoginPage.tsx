import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

type Mode = 'signin' | 'signup' | 'forgot';

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<Mode>('signin');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    if (mode === 'forgot') {
      try {
        const res = await fetch(`${API_BASE}/api/auth/forgot-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const body = await res.json().catch(() => ({})) as { message?: string; error?: string };
        setLoading(false);
        if (!res.ok) {
          setError(body.error ?? 'Something went wrong. Please try again.');
        } else {
          setSuccess(body.message ?? 'If an account exists for that email, a reset link has been sent.');
        }
      } catch {
        setLoading(false);
        setError('Could not reach the server. Make sure VITE_API_URL is set in your environment variables.');
      }
      return;
    }

    if (mode === 'signup') {
      try {
        const res = await fetch(`${API_BASE}/api/auth/signup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const body = await res.json().catch(() => ({})) as { error?: string; message?: string };
        setLoading(false);
        if (!res.ok) {
          setError(body.error ?? 'Signup failed. Please try again.');
        } else {
          setSuccess(body.message ?? 'Account created! Check your email to confirm your address before signing in.');
        }
      } catch {
        setLoading(false);
        setError('Could not reach the server. Make sure VITE_API_URL is set in your environment variables.');
      }
      return;
    }

    // Sign in
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (authError) {
      setError(authError.message);
      return;
    }

    navigate('/home');
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setSuccess(null);
  };

  return (
    <>
      {/* Fixed blue left accent stripe */}
      <div
        className="fixed top-0 left-0 w-1 h-full z-50"
        style={{ background: '#0b61a1' }}
      />

      <main className="flex min-h-screen">
        {/* ── Left branding panel (desktop only) ──────────────────────────── */}
        <div
          className="hidden lg:flex lg:w-7/12 relative overflow-hidden flex-col signal-gradient"
        >
          {/* Blob glows */}
          <div
            className="absolute -top-24 -left-24 w-[480px] h-[480px] rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, rgba(11,97,161,0.35) 0%, transparent 70%)' }}
          />
          <div
            className="absolute bottom-0 right-0 w-80 h-80 rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, rgba(46,117,182,0.25) 0%, transparent 70%)' }}
          />
          <div
            className="absolute top-1/2 left-1/3 w-64 h-64 rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, rgba(11,97,161,0.12) 0%, transparent 70%)' }}
          />

          <div className="relative z-10 flex flex-col h-full p-12 xl:p-16">
            {/* Brand header */}
            <div className="flex items-center gap-3 mb-16">
              <span
                className="material-symbols-outlined text-white"
                style={{ fontSize: 32, fontVariationSettings: "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 32" }}
              >
                sensors
              </span>
              <div>
                <div className="text-white font-semibold text-lg leading-tight">Vimi Digital</div>
                <div
                  className="glass-panel mt-1.5 inline-flex items-center px-3 py-0.5 rounded-full text-xs text-white/70"
                >
                  Intelligence Platform v4.0
                </div>
              </div>
            </div>

            {/* Main copy */}
            <div className="flex-1 flex flex-col justify-center">
              <h1
                className="font-extrabold text-white leading-none mb-4"
                style={{ fontSize: 'clamp(3.5rem, 6vw, 5.5rem)' }}
              >
                Atlas
              </h1>
              <h2 className="text-xl font-semibold text-white/70 mb-5">
                Signal Intelligence Platform
              </h2>
              <p className="text-white/50 text-[15px] leading-relaxed max-w-md mb-12">
                Complete visibility into your marketing signal infrastructure.
                Audit, optimise, and validate your tracking across every channel.
              </p>

              {/* Stats grid */}
              <div className="grid grid-cols-2 gap-4 max-w-sm">
                <div className="glass-panel rounded-xl p-5">
                  <div className="text-3xl font-bold text-white">99.9%</div>
                  <div className="text-white/50 text-sm mt-1">Signal accuracy</div>
                </div>
                <div className="glass-panel rounded-xl p-5">
                  <div className="text-3xl font-bold text-white">1.2M+</div>
                  <div className="text-white/50 text-sm mt-1">Events tracked</div>
                </div>
              </div>
            </div>

            {/* Left panel footer */}
            <div className="text-white/30 text-xs">
              © 2026 Vimi Digital. All rights reserved.
            </div>
          </div>
        </div>

        {/* ── Right form panel ─────────────────────────────────────────────── */}
        <div className="w-full lg:w-5/12 bg-white flex flex-col justify-center px-8 sm:px-12 lg:px-14 xl:px-20 py-12">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-2 mb-10">
            <span
              className="material-symbols-outlined"
              style={{ color: '#1b2a4a', fontSize: 28, fontVariationSettings: "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 28" }}
            >
              sensors
            </span>
            <span className="font-extrabold text-xl" style={{ color: '#1b2a4a' }}>Atlas</span>
          </div>

          <div className="w-full max-w-sm mx-auto">
            {/* Heading */}
            <h3
              className="text-2xl font-bold mb-2"
              style={{ color: '#0f172a' }}
            >
              {mode === 'signup'
                ? 'Create an account'
                : mode === 'forgot'
                  ? 'Reset your password'
                  : 'Welcome back'}
            </h3>
            <p className="text-sm text-gray-500 mb-8">
              {mode === 'signup'
                ? 'Start your free trial today'
                : mode === 'forgot'
                  ? 'Enter your email to receive a reset link'
                  : 'Sign in to your Atlas workspace'}
            </p>

            {/* Feedback banners */}
            {error && (
              <div className="mb-5 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <span
                  className="material-symbols-outlined mt-0.5 flex-shrink-0"
                  style={{ fontSize: 16 }}
                >
                  error
                </span>
                {error}
              </div>
            )}
            {success && (
              <div className="mb-5 flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                <span
                  className="material-symbols-outlined mt-0.5 flex-shrink-0"
                  style={{ fontSize: 16 }}
                >
                  check_circle
                </span>
                {success}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Email */}
              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-medium mb-1.5"
                  style={{ color: '#374151' }}
                >
                  Email address
                </label>
                <div className="relative">
                  <span
                    className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                    style={{ fontSize: 18, color: '#9ca3af' }}
                  >
                    mail
                  </span>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="you@company.com"
                    className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-900 placeholder-gray-400 transition focus:outline-none focus:ring-2 focus:bg-white"
                    style={{ '--tw-ring-color': '#0b61a1' } as React.CSSProperties}
                    onFocus={(e) => { e.target.style.boxShadow = '0 0 0 2px #0b61a1'; }}
                    onBlur={(e) => { e.target.style.boxShadow = ''; }}
                  />
                </div>
              </div>

              {/* Password */}
              {mode !== 'forgot' && (
                <div>
                  <label
                    htmlFor="password"
                    className="block text-sm font-medium mb-1.5"
                    style={{ color: '#374151' }}
                  >
                    Password
                  </label>
                  <div className="relative">
                    <span
                      className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                      style={{ fontSize: 18, color: '#9ca3af' }}
                    >
                      lock
                    </span>
                    <input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={8}
                      placeholder="••••••••"
                      className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-900 placeholder-gray-400 transition focus:outline-none focus:bg-white"
                      onFocus={(e) => { e.target.style.boxShadow = '0 0 0 2px #0b61a1'; }}
                      onBlur={(e) => { e.target.style.boxShadow = ''; }}
                    />
                  </div>
                </div>
              )}

              {/* Remember me + Forgot (signin only) */}
              {mode === 'signin' && (
                <div className="flex items-center justify-between pt-0.5">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-gray-300 accent-[#0b61a1]"
                    />
                    <span className="text-sm text-gray-600">Remember me for 30 days</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => switchMode('forgot')}
                    className="text-sm font-medium hover:underline"
                    style={{ color: '#0b61a1' }}
                  >
                    Forgot password?
                  </button>
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 rounded-lg py-3 px-4 text-white text-sm font-semibold transition-opacity disabled:opacity-60 mt-2"
                style={{ background: 'linear-gradient(135deg, #0b61a1 0%, #1b2a4a 100%)' }}
              >
                {loading ? (
                  <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                ) : (
                  <>
                    <span>
                      {mode === 'signup'
                        ? 'Create account'
                        : mode === 'forgot'
                          ? 'Send reset link'
                          : 'Access Atlas'}
                    </span>
                    {mode === 'signin' && (
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: 18 }}
                      >
                        arrow_forward
                      </span>
                    )}
                  </>
                )}
              </button>
            </form>

            {/* Mode switcher */}
            <div className="mt-6 text-center">
              {mode === 'forgot' ? (
                <button
                  onClick={() => switchMode('signin')}
                  className="text-sm text-gray-600 hover:text-gray-900 inline-flex items-center gap-1"
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 16 }}
                  >
                    arrow_back
                  </span>
                  Back to sign in
                </button>
              ) : (
                <p className="text-sm text-gray-600">
                  {mode === 'signup' ? 'Already have an account? ' : "Don't have an account? "}
                  <button
                    onClick={() => switchMode(mode === 'signup' ? 'signin' : 'signup')}
                    className="font-semibold hover:underline"
                    style={{ color: '#0b61a1' }}
                  >
                    {mode === 'signup' ? 'Sign in' : 'Sign up free'}
                  </button>
                </p>
              )}
            </div>

            {/* SSO divider + buttons (signin only) */}
            {mode === 'signin' && (
              <div className="mt-8">
                <div className="relative flex items-center">
                  <div className="flex-1 border-t border-gray-200" />
                  <span className="mx-4 text-xs text-gray-400">Or continue with</span>
                  <div className="flex-1 border-t border-gray-200" />
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    className="flex items-center justify-center gap-2 rounded-lg border border-gray-200 py-2.5 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                    </svg>
                    Google
                  </button>
                  <button
                    type="button"
                    className="flex items-center justify-center gap-2 rounded-lg border border-gray-200 py-2.5 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <svg width="16" height="16" viewBox="0 0 32 32" fill="none" aria-hidden>
                      <rect width="32" height="32" rx="4" fill="#00297A" />
                      <path d="M16 8L8 12.5V19.5L16 24L24 19.5V12.5L16 8Z" fill="white" fillOpacity="0.9" />
                    </svg>
                    Okta SSO
                  </button>
                </div>
              </div>
            )}

            {/* Footer links */}
            <div className="mt-10 text-center text-xs text-gray-400 space-x-4">
              <a href="#" className="hover:text-gray-600 transition-colors">Privacy</a>
              <span>·</span>
              <a href="#" className="hover:text-gray-600 transition-colors">Terms</a>
              <span>·</span>
              <a href="#" className="hover:text-gray-600 transition-colors">Support</a>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
