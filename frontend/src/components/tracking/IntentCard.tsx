import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin, CheckCircle, Search, AlertCircle, ArrowRight, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { TrackingPreconditions } from '@/types/tracking';

export type Intent = 'plan_from_scratch' | 'audit_existing' | 'inventory';

interface IntentCardProps {
  intent: Intent;
  preconditions: TrackingPreconditions & { subscription_supports_cse: boolean };
  clientId: string;
  businessType: string | null;
  onPreconditionSaved?: () => void;
}

const INTENT_CONFIG: Record<Intent, {
  Icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  bestWhen: string;
  output: string;
  ctaLabel: string;
}> = {
  plan_from_scratch: {
    Icon: CheckCircle,
    title: 'Plan tagging from scratch',
    description: 'Build a structured tagging plan based on your client\'s business type.',
    bestWhen: 'Your client has little or no existing tracking, or you want a clean reset.',
    output: 'Tagging plan in Signal Library, dataLayer spec, GTM container JSON',
    ctaLabel: 'Open Journey Builder',
  },
  audit_existing: {
    Icon: MapPin,
    title: 'Audit and improve existing tagging',
    description: 'Scan the client\'s site and get AI-curated recommendations to fix gaps.',
    bestWhen: 'Your client already has tracking and you want to improve it, not replace it.',
    output: 'Approved recommendations in Signal Library, implementation guide, updated GTM container',
    ctaLabel: 'Open Planning Mode',
  },
  inventory: {
    Icon: Search,
    title: 'Inventory what\'s currently running',
    description: 'Catalogue every tracking signal currently firing on the site.',
    bestWhen: 'Discovery calls, status checks, or pre-pitch audits.',
    output: 'Signal inventory report',
    ctaLabel: 'Run a site scan',
  },
};

export function IntentCard({ intent, preconditions, clientId, businessType, onPreconditionSaved }: IntentCardProps) {
  const navigate = useNavigate();
  const config = INTENT_CONFIG[intent];
  const { Icon } = config;
  const [fixingField, setFixingField] = useState<'website_url' | 'business_type' | null>(null);
  const [fieldValue, setFieldValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function getMissingPrecondition(): { field: 'website_url' | 'business_type'; label: string } | null {
    if (intent === 'audit_existing' || intent === 'inventory') {
      if (!preconditions.website_url) return { field: 'website_url', label: 'Add website URL first' };
    }
    if (intent === 'plan_from_scratch') {
      if (!preconditions.business_type) return { field: 'business_type', label: 'Set business type first' };
    }
    return null;
  }

  function isCseGated(): boolean {
    return intent === 'inventory' && !preconditions.subscription_supports_cse;
  }

  const missing = getMissingPrecondition();
  const cseGated = isCseGated();
  const isDisabled = !!missing || cseGated;

  function handleCta() {
    if (intent === 'plan_from_scratch') {
      const params = new URLSearchParams({ client_id: clientId });
      if (businessType) params.set('business_type', businessType);
      navigate(`/journey/new?${params.toString()}`);
    } else if (intent === 'audit_existing') {
      navigate(`/planning/new?client_id=${clientId}`);
    } else if (intent === 'inventory') {
      navigate(`/planning/new?client_id=${clientId}&mode=inventory`);
    }
  }

  async function handleSavePrecondition() {
    if (!fixingField || !fieldValue.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const { supabase } = await import('@/lib/supabase');
      const { data: { session } } = await supabase.auth.getSession();
      if (session) headers['Authorization'] = `Bearer ${session.access_token}`;
      const apiBase = import.meta.env.VITE_API_URL ?? '';
      const res = await fetch(`${apiBase}/api/organisations/clients/${clientId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ [fixingField]: fieldValue.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? 'Save failed');
      }
      setFixingField(null);
      setFieldValue('');
      onPreconditionSaved?.();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Card className={cn(
        'relative flex flex-col border transition-shadow',
        isDisabled ? 'opacity-50' : 'hover:shadow-md',
      )}>
        <CardContent className="flex flex-1 flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[#1B2A4A]/10">
                <Icon className="h-4 w-4 text-[#1B2A4A]" />
              </div>
              <h3 className="text-sm font-semibold text-[#1A1A1A]">{config.title}</h3>
            </div>
            {cseGated && <Badge variant="outline" className="shrink-0 text-xs">Pro</Badge>}
          </div>

          <p className="text-xs text-muted-foreground">{config.description}</p>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Best when:</p>
            <p className="text-xs text-muted-foreground italic">{config.bestWhen}</p>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Output:</p>
            <p className="text-xs text-muted-foreground">{config.output}</p>
          </div>

          <div className="mt-auto pt-2">
            {missing ? (
              <Button
                size="sm"
                variant="outline"
                className="w-full gap-1.5 text-xs border-amber-300 text-amber-700 hover:bg-amber-50"
                onClick={() => { setFixingField(missing.field); setFieldValue(''); }}
              >
                <AlertCircle className="h-3.5 w-3.5" />
                {missing.label}
              </Button>
            ) : cseGated ? (
              <Button
                size="sm"
                variant="outline"
                className="w-full gap-1.5 text-xs"
                onClick={() => navigate('/settings')}
              >
                <Lock className="h-3.5 w-3.5" />
                Upgrade to run site scans
              </Button>
            ) : (
              <Button
                size="sm"
                className="w-full gap-1.5 bg-[#1B2A4A] text-white hover:bg-[#1B2A4A]/90 text-xs"
                onClick={handleCta}
              >
                {config.ctaLabel}
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!fixingField} onOpenChange={(open) => { if (!open) setFixingField(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {fixingField === 'website_url' ? 'Add website URL' : 'Set business type'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="fix-field">
                {fixingField === 'website_url' ? 'Website URL' : 'Business type'}
              </Label>
              {fixingField === 'website_url' ? (
                <Input
                  id="fix-field"
                  placeholder="https://example.com"
                  value={fieldValue}
                  onChange={(e) => setFieldValue(e.target.value)}
                  autoFocus
                />
              ) : (
                <select
                  id="fix-field"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={fieldValue}
                  onChange={(e) => setFieldValue(e.target.value)}
                >
                  <option value="">Select a type…</option>
                  <option value="ecommerce">Ecommerce</option>
                  <option value="lead_gen">Lead Generation</option>
                  <option value="b2b_saas">B2B SaaS</option>
                  <option value="b2b_lead_gen">B2B Lead Gen</option>
                  <option value="marketplace">Marketplace</option>
                  <option value="nonprofit">Nonprofit</option>
                </select>
              )}
            </div>
            {saveError && <p className="text-xs text-red-600">{saveError}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setFixingField(null)} disabled={saving}>Cancel</Button>
            <Button
              onClick={handleSavePrecondition}
              disabled={saving || !fieldValue.trim()}
              className="bg-[#1B2A4A] text-white hover:bg-[#1B2A4A]/90"
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
