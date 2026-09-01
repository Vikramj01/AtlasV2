import { useSearchParams, Link } from 'react-router-dom';
import { CheckCircle2, Mail, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Landing page after a Shopify OAuth install completes
 * (redirected to from GET /api/shopify/callback). Unauthenticated — no
 * Atlas session exists yet, this is purely informational. The merchant's
 * real login happens via the invite email sent during provisioning
 * (shopifyProvisioning.ts).
 */
export function ShopifyWelcomePage() {
  const [params] = useSearchParams();
  const shop = params.get('shop');

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <Card className="w-full max-w-lg">
        <CardHeader className="items-center text-center">
          <CheckCircle2 className="h-10 w-10 text-green-600" />
          <CardTitle className="text-xl">Your store is connected</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6 text-center">
          <p className="text-sm text-muted-foreground">
            {shop ? <>Atlas is now installed on <span className="font-medium text-foreground">{shop}</span>.</> : 'Atlas is now installed on your store.'}
            {' '}Orders and refunds will start forwarding to any ad platforms you connect below.
          </p>

          <div className="rounded-lg border bg-background p-4 text-left">
            <div className="flex items-start gap-3">
              <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Check your email</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  We've sent a link to set your password and log into the full Atlas
                  dashboard — same store, same data, nothing to set up again.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border bg-background p-4 text-left">
            <div className="flex items-start gap-3">
              <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Connect your ad platforms</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Once you've logged in, connect Google Ads and/or Meta from{' '}
                  <Link to="/connections" className="underline underline-offset-2">
                    Connections
                  </Link>{' '}
                  to start receiving order and refund data.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
