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

          {/* Brand header — absolutely positioned so it doesn't push Atlas off-center */}
          <div className="absolute top-0 left-0 right-0 z-20 flex items-center gap-3 p-12 xl:p-16">
            <span
              className="material-symbols-outlined text-white"
              style={{ fontSize: 32, fontVariationSettings: "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 32" }}
            >
              sensors
            </span>
            <div>
              <div className="text-white font-semibold text-lg leading-tight">Vimi Digital</div>
              <div className="glass-panel mt-1.5 inline-flex items-center px-3 py-0.5 rounded-full text-xs text-white/70">
                Intelligence Platform v4.0
              </div>
            </div>
          </div>

          {/* Main copy — centred in the full panel height */}
          <div className="relative z-10 flex flex-col items-start justify-center h-full px-12 xl:px-16">
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

          {/* Left panel footer — absolutely positioned */}
          <div className="absolute bottom-0 left-0 right-0 z-20 px-12 xl:px-16 pb-8 text-white/30 text-xs">
            © 2026 Vimi Digital. All rights reserved.
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
