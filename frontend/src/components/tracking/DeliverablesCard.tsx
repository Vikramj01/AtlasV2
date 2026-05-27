import { useState } from 'react';
import { Download, Link, RefreshCw, Copy, Check, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useTrackingHubStore } from '@/store/trackingHubStore';
import type { Deployment } from '@/types/tracking';

interface DeliverablesCardProps {
  clientId: string;
  deliverables: Deployment['deliverables'];
}

export function DeliverablesCard({ clientId, deliverables }: DeliverablesCardProps) {
  const { buildAndDownloadDeliverables, generateShareLink, isGeneratingDeliverables, isGeneratingShareLink, shareUrl, error } = useTrackingHubStore();
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString();
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Package className="h-4 w-4 text-muted-foreground" />
          Deliverables
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* dataLayer Spec section */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-foreground">For your developer</p>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium">dataLayer spec</p>
                {deliverables.datalayer_spec?.last_generated_at && (
                  <p className="text-[10px] text-muted-foreground">
                    Last generated {formatDate(deliverables.datalayer_spec.last_generated_at)}
                  </p>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 text-xs"
                disabled={isGeneratingDeliverables}
                onClick={() => buildAndDownloadDeliverables(clientId, 'datalayer_spec')}
              >
                <Download className="h-3.5 w-3.5" />
                {isGeneratingDeliverables ? 'Building…' : 'Download JSON'}
              </Button>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium">Shareable link</p>
                {deliverables.datalayer_spec?.expires_at && (
                  <p className="text-[10px] text-muted-foreground">
                    {deliverables.datalayer_spec.shareable_url
                      ? `Expires ${formatDate(deliverables.datalayer_spec.expires_at)}`
                      : 'No active link'}
                  </p>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 text-xs"
                disabled={isGeneratingShareLink}
                onClick={() => generateShareLink(clientId, 30)}
              >
                <Link className="h-3.5 w-3.5" />
                {isGeneratingShareLink ? 'Generating…' : 'Generate link'}
              </Button>
            </div>

            {shareUrl && (
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={shareUrl}
                  className="h-8 text-xs font-mono bg-muted"
                />
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 shrink-0"
                  onClick={handleCopy}
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* GTM Container section */}
        <div className="space-y-2 border-t pt-4">
          <p className="text-xs font-medium text-foreground">For GTM import</p>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium">GTM container JSON</p>
              {deliverables.gtm_container?.last_generated_at && (
                <p className="text-[10px] text-muted-foreground">
                  Last generated {formatDate(deliverables.gtm_container.last_generated_at)}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 text-xs"
                disabled={isGeneratingDeliverables}
                onClick={() => buildAndDownloadDeliverables(clientId, 'gtm_container')}
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 text-xs text-muted-foreground"
                disabled={isGeneratingDeliverables}
                onClick={() => buildAndDownloadDeliverables(clientId, 'gtm_container')}
              >
                <RefreshCw className="h-3 w-3" />
                Regenerate
              </Button>
            </div>
          </div>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}
      </CardContent>
    </Card>
  );
}
