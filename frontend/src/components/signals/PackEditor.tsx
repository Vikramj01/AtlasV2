/**
 * PackEditor — modal to create a new signal pack.
 * Can start from scratch or clone a system pack.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { signalApi } from '@/lib/api/signalApi';
import type { SignalPack } from '@/types/signal';

interface Props {
  orgId: string;
  onCreated: (pack: SignalPack) => void;
  onClose: () => void;
}

const BUSINESS_TYPES = ['ecommerce', 'saas', 'lead_gen', 'content', 'marketplace', 'custom'];

export function PackEditor({ orgId, onCreated, onClose }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [businessType, setBusinessType] = useState('ecommerce');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!name.trim()) { setError('Pack name is required'); return; }
    setIsSubmitting(true);
    setError(null);
    try {
      const pack = await signalApi.createPack({
        name: name.trim(),
        description: description.trim() || undefined,
        business_type: businessType,
        organisation_id: orgId,
      });
      onCreated(pack);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create pack');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-md">
        <CardContent className="p-6 space-y-4">
          <h2 className="text-base font-bold">New signal pack</h2>

          <div className="space-y-1">
            <Label htmlFor="pack-name" className="text-xs">Pack name</Label>
            <Input id="pack-name" placeholder="Shopify Ecommerce — Our Standard" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pack-desc" className="text-xs">Description (optional)</Label>
            <Input id="pack-desc" placeholder="Standard ecommerce tracking for Shopify clients" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Business type</Label>
            <div className="flex flex-wrap gap-2">
              {BUSINESS_TYPES.map((bt) => (
                <button
                  key={bt}
                  type="button"
                  onClick={() => setBusinessType(bt)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    businessType === bt ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'
                  }`}
                >
                  {bt}
                </button>
              ))}
            </div>
          </div>

          <p className="text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">
            After creating the pack, go to the Signal Library to add signals.
          </p>

          {error && <p className="text-xs text-red-600 bg-red-50 rounded px-3 py-2">{error}</p>}

          <div className="flex justify-between pt-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={handleCreate} disabled={isSubmitting}>
              {isSubmitting ? 'Creating…' : 'Create pack'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
