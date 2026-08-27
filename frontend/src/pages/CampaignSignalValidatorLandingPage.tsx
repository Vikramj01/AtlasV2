import { useState } from 'react';
import type * as React from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { campaignSignalValidatorApi } from '@/lib/api/campaignSignalValidatorApi';

/**
 * Public, unauthenticated landing page for the standalone Campaign Signal
 * Validator product (B9) — a one-time $500-800 paid diagnostic, separate
 * from the in-app version embedded on ClientDetailPage. No account required:
 * enter a URL + email, pay via Stripe Checkout, get the report.
 */
export function CampaignSignalValidatorLandingPage() {
  const [url, setUrl] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { data } = await campaignSignalValidatorApi.createCheckout(url.trim(), email.trim());
      window.location.href = data.checkoutUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-6 py-16">
      <div className="mb-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <ShieldCheck className="h-6 w-6 text-primary" />
        </div>
        <h1 className="mt-4 text-3xl font-bold tracking-tight">Campaign Signal Validator</h1>
        <p className="mt-2 text-muted-foreground">
          Before you turn on Google AI Max or any automated bidding, find out whether your
          primary conversion action is a strong signal — or a proxy metric that will scale the
          wrong thing.
        </p>
      </div>

      <Card className="w-full">
        <CardHeader>
          <CardTitle>Get your report</CardTitle>
          <CardDescription>One-time diagnostic, delivered as a PDF report to your email.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="csv-url">Website URL</Label>
              <Input
                id="csv-url"
                type="url"
                required
                placeholder="https://example.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="csv-email">Email</Label>
              <Input
                id="csv-email"
                type="email"
                required
                placeholder="you@agency.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="submit" className="w-full" disabled={loading || !url.trim() || !email.trim()}>
              {loading ? 'Redirecting to checkout…' : 'Get my diagnostic'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
