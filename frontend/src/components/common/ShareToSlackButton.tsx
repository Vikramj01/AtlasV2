import { useState, useEffect } from 'react';
import { MessageSquare, Check, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { slackApi } from '@/lib/api/slackApi';
import { useSlackStore } from '@/store/slackStore';

interface Props {
  onShare: (destinationId: string) => Promise<void>;
  label?: string;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'default' | 'sm' | 'lg';
}

export function ShareToSlackButton({ onShare, label = 'Share to Slack', variant = 'outline', size = 'sm' }: Props) {
  const { destinations, setDestinations, isLoading, setLoading } = useSlackStore();
  const [open, setOpen] = useState(false);
  const [sharing, setSharing] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; ok: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (destinations.length > 0) return;
    setLoading(true);
    slackApi.listDestinations()
      .then(setDestinations)
      .catch(() => setError('Failed to load Slack destinations'))
      .finally(() => setLoading(false));
  }, [open, destinations.length, setDestinations, setLoading]);

  async function handleShare(destinationId: string) {
    setSharing(destinationId);
    setResult(null);
    setError(null);
    try {
      await onShare(destinationId);
      setResult({ id: destinationId, ok: true });
    } catch (err) {
      setResult({ id: destinationId, ok: false });
      setError(err instanceof Error ? err.message : 'Failed to share');
    } finally {
      setSharing(null);
    }
  }

  const activeDestinations = destinations.filter((d) => d.enabled);

  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)}>
        <MessageSquare className="h-4 w-4 mr-2" />
        {label}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Share to Slack</DialogTitle>
          </DialogHeader>

          {isLoading && (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {!isLoading && activeDestinations.length === 0 && (
            <p className="text-sm text-muted-foreground py-4">
              No Slack destinations configured. Add one in{' '}
              <span className="font-medium">Org Settings → Slack</span>.
            </p>
          )}

          {!isLoading && activeDestinations.length > 0 && (
            <ul className="space-y-2">
              {activeDestinations.map((dest) => (
                <li key={dest.id} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{dest.name}</p>
                    {dest.channel_hint && (
                      <p className="text-xs text-muted-foreground truncate">{dest.channel_hint}</p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant={result?.id === dest.id && result.ok ? 'default' : 'outline'}
                    disabled={sharing !== null}
                    onClick={() => handleShare(dest.id)}
                    className="shrink-0"
                  >
                    {sharing === dest.id && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                    {result?.id === dest.id && result.ok && <Check className="h-3 w-3 mr-1" />}
                    {result?.id === dest.id && !result.ok && <X className="h-3 w-3 mr-1" />}
                    {result?.id === dest.id ? (result.ok ? 'Sent' : 'Failed') : 'Send'}
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {error && (
            <p className="text-xs text-destructive mt-2">{error}</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
