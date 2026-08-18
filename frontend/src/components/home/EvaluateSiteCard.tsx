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
import { useAudit } from '@/hooks/useAudit';
import type { FunnelType } from '@/types/audit';

const FUNNEL_OPTIONS: { value: FunnelType; label: string }[] = [
  { value: 'ecommerce', label: 'Ecommerce' },
  { value: 'saas', label: 'SaaS' },
  { value: 'lead_gen', label: 'Lead Gen' },
];

/**
 * "Evaluate a site" — the Audit Engine's bare-URL entry point. No client
 * required: agencies use this to pitch a prospect or check on an existing
 * client. A quick URL + funnel-type form covers the common case; "Advanced"
 * reveals RunAuditForm's full per-step journey mapping for anyone who wants
 * to map the whole funnel up front.
 */
export function EvaluateSiteCard() {
  const navigate = useNavigate();
  const { startAudit, loading, error } = useAudit();
  const [url, setUrl] = useState('');
  const [funnelType, setFunnelType] = useState<FunnelType>('ecommerce');
  const [showAdvanced, setShowAdvanced] = useState(false);

  async function handleQuickSubmit(e: React.FormEvent) {
    e.preventDefault();
    const auditId = await startAudit({
      website_url: url.trim(),
      funnel_type: funnelType,
      region: 'us',
      url_map: { landing: url.trim() },
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
            <Label className="font-heading text-[13px] font-semibold text-console-fg-muted">Funnel type</Label>
            <Select value={funnelType} onValueChange={(v) => setFunnelType(v as FunnelType)}>
              <SelectTrigger className="border-console-border bg-console-chip text-console-fg focus:ring-console-primary">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FUNNEL_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
          )}

          <div className="mt-auto space-y-2 pt-2">
            <Button
              type="submit"
              disabled={loading || !url.trim()}
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
