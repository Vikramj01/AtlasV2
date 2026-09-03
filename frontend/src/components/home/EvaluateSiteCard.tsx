import { useState } from 'react';
import type * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RunAuditForm } from '@/components/audit/RunAuditForm';
import { MultiChipToggle } from '@/components/audit/MultiChipToggle';
import { useAudit } from '@/hooks/useAudit';
import { SITE_TYPE_OPTIONS, DECLARED_PLATFORM_OPTIONS, TRAFFIC_REGION_OPTIONS } from '@/lib/scanInputOptions';
import type { SiteType, DeclaredPlatform, TrafficRegion } from '@/types/audit';

/**
 * "Evaluate a site" — the Audit Engine's bare-URL entry point. No client
 * required: agencies use this to pitch a prospect or check on an existing
 * client. Collects the Check Register's required Scan Inputs (site type,
 * declared platforms + primary channel, traffic regions) — the minimum the
 * scan needs to score correctly instead of grading channels the advertiser
 * doesn't buy. "Advanced" reveals the full Scan Inputs (secondary motion,
 * spend band, CMP, checkout domain, declared conversions) plus per-step
 * journey mapping for anyone who wants to map the whole funnel up front.
 */
export function EvaluateSiteCard() {
  const navigate = useNavigate();
  const { startAudit, loading, error } = useAudit();
  const [url, setUrl] = useState('');
  const [siteType, setSiteType] = useState<SiteType>('ecommerce');
  const [declaredPlatforms, setDeclaredPlatforms] = useState<DeclaredPlatform[]>([]);
  const [primaryChannel, setPrimaryChannel] = useState<DeclaredPlatform | ''>('');
  const [trafficRegions, setTrafficRegions] = useState<TrafficRegion[]>(['us']);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handlePlatformsChange = (next: DeclaredPlatform[]) => {
    setDeclaredPlatforms(next);
    // Keep primary channel valid — default to the first declared platform,
    // clear it if the user deselected everything.
    if (!next.includes(primaryChannel as DeclaredPlatform)) {
      setPrimaryChannel(next[0] ?? '');
    }
  };

  const canSubmit = url.trim() && declaredPlatforms.length > 0 && primaryChannel && trafficRegions.length > 0;

  async function handleQuickSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!primaryChannel) return;
    const websiteUrl = url.trim();
    const auditId = await startAudit({
      website_url: websiteUrl,
      site_type: siteType,
      declared_platforms: declaredPlatforms,
      primary_channel: primaryChannel,
      traffic_regions: trafficRegions,
      product_domain: websiteUrl,
      url_map: { landing: websiteUrl },
    });
    if (auditId) navigate(`/audit/${auditId}/progress`);
  }

  if (showAdvanced) {
    return (
      <div className="space-y-2">
        <Button variant="ghost" size="sm" className="px-0 text-xs" onClick={() => setShowAdvanced(false)}>
          ← Back to quick evaluate
        </Button>
        <RunAuditForm />
      </div>
    );
  }

  return (
    <Card className="flex flex-col rounded-[10px] border-console-border bg-console-surface">
      <CardHeader className="p-7">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-console-primary/20 bg-console-primary/10">
          <Search className="h-[19px] w-[19px] text-console-primary" strokeWidth={1.75} />
        </div>
        <CardTitle className="mt-2.5 font-heading text-xl font-bold text-console-fg">Evaluate a site</CardTitle>
        <CardDescription className="text-console-fg-muted leading-relaxed">
          Scan any URL and get a scored gap report — no client setup required. Great for pitching a
          prospect or checking in on an existing client.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col p-7 pt-0">
        <form onSubmit={handleQuickSubmit} className="flex flex-1 flex-col gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="evaluate-url" className="font-heading text-[13px] font-semibold text-console-fg-muted">
              Website URL
            </Label>
            <Input
              id="evaluate-url"
              type="url"
              required
              placeholder="https://example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="border-console-border bg-console-chip font-mono text-[13px] text-console-fg placeholder:text-console-fg-disabled focus-visible:ring-console-primary"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="font-heading text-[13px] font-semibold text-console-fg-muted">Site type</Label>
            <Select value={siteType} onValueChange={(v) => setSiteType(v as SiteType)}>
              <SelectTrigger className="border-console-border bg-console-chip text-console-fg focus:ring-console-primary">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SITE_TYPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="font-heading text-[13px] font-semibold text-console-fg-muted">
              Ad platforms you buy
            </Label>
            <p className="text-xs text-console-fg-muted">
              Only declared platforms are scored — everything else reports Out of Scope, not Broken.
            </p>
            <MultiChipToggle
              options={DECLARED_PLATFORM_OPTIONS}
              selected={declaredPlatforms}
              onChange={handlePlatformsChange}
            />
          </div>

          {declaredPlatforms.length > 0 && (
            <div className="space-y-1.5">
              <Label className="font-heading text-[13px] font-semibold text-console-fg-muted">Primary channel</Label>
              <Select value={primaryChannel} onValueChange={(v) => setPrimaryChannel(v as DeclaredPlatform)}>
                <SelectTrigger className="border-console-border bg-console-chip text-console-fg focus:ring-console-primary">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DECLARED_PLATFORM_OPTIONS.filter((o) => declaredPlatforms.includes(o.value)).map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="font-heading text-[13px] font-semibold text-console-fg-muted">Traffic regions</Label>
            <MultiChipToggle
              options={TRAFFIC_REGION_OPTIONS}
              selected={trafficRegions}
              onChange={setTrafficRegions}
            />
          </div>

          {error && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
          )}

          <div className="mt-auto space-y-2 pt-2">
            <Button
              type="submit"
              disabled={loading || !canSubmit}
              className="w-full bg-console-primary font-heading font-bold hover:bg-console-primary-hover disabled:shadow-none shadow-console-glow"
            >
              {loading ? 'Starting…' : 'Evaluate'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowAdvanced(true)}
              className="w-full font-heading text-xs font-semibold text-console-fg-muted"
            >
              Advanced — map the full journey
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
