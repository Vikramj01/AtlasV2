import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

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
        // If the response isn't JSON (e.g. Vercel 404 HTML), res.json() throws
        const body = await res.json().catch(() => ({})) as { message?: string; error?: string };
        setLoading(false);
        if (!res.ok) {
          setError(body.error ?? 'Something went wrong. Please try again.');
        } else {
          setSuccess(body.message ?? 'If an account exists for that email, a reset link has been sent.');
        }
      } catch {
        setLoading(false);
        setError('Could not reach the server. Make sure VITE_API_URL is set in your Vercel environment variables.');
      }
      return;
    }

    if (mode === 'signup') {
      // Sign up via backend so the account is confirmed immediately —
      // no confirmation email required.
      try {
        const res = await fetch(`${API_BASE}/api/auth/signup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const body = await res.json().catch(() => ({})) as { error?: string };
        if (!res.ok) {
          setLoading(false);
          setError(body.error ?? 'Signup failed. Please try again.');
          return;
        }
      } catch {
        setLoading(false);
        setError('Could not reach the server. Make sure VITE_API_URL is set in your Vercel environment variables.');
        return;
      }

      // Account created and confirmed — sign in immediately
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      setLoading(false);
      if (signInError) {
        setError(signInError.message);
        return;
      }
      navigate('/home');
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
    <div className="flex min-h-screen items-center justify-center bg-muted/30">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Atlas</CardTitle>
          <CardDescription>
            {mode === 'signup' ? 'Create your account' : mode === 'forgot' ? 'Reset your password' : 'Sign in to your account'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            {mode !== 'forgot' && (
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                />
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
            {success && <p className="text-sm text-green-600">{success}</p>}

            <Button type="submit" disabled={loading} className="w-full bg-brand-600 hover:bg-brand-700">
              {loading ? 'Please wait...' : mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : 'Sign in'}
            </Button>
          </form>

          {mode === 'signin' && (
            <Button
              variant="ghost"
              onClick={() => switchMode('forgot')}
              className="mt-2 w-full text-muted-foreground text-sm"
            >
              Forgot your password?
            </Button>
          )}

          <Button
            variant="ghost"
            onClick={() => switchMode(mode === 'signup' ? 'signin' : 'signup')}
            className="mt-2 w-full text-muted-foreground"
          >
            {mode === 'signup' ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
          </Button>

          {mode === 'forgot' && (
            <Button
              variant="ghost"
              onClick={() => switchMode('signin')}
              className="mt-2 w-full text-muted-foreground text-sm"
            >
              Back to sign in
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
