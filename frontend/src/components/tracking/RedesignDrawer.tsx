import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { IntentCard } from './IntentCard';
import type { TrackingPreconditions } from '@/types/tracking';

interface RedesignDrawerProps {
  clientId: string;
  businessType: string | null;
  preconditions: TrackingPreconditions & { subscription_supports_cse: boolean };
  hasBaseline: boolean;
  onPreconditionSaved?: () => void;
}

export function RedesignDrawer({
  clientId,
  businessType,
  preconditions,
  hasBaseline,
  onPreconditionSaved,
}: RedesignDrawerProps) {
  const [open, setOpen] = useState(false);
  const [showWarning, setShowWarning] = useState(false);

  function handleTriggerClick() {
    if (hasBaseline) {
      setShowWarning(true);
    } else {
      setOpen(true);
    }
  }

  return (
    <>
      <div className="pt-2 text-center">
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground hover:underline"
          onClick={handleTriggerClick}
        >
          Need to redesign or add to existing tracking?
        </button>
      </div>

      {/* Baseline warning dialog */}
      <Dialog open={showWarning} onOpenChange={setShowWarning}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Redesign tracking?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Redesigning your tagging will invalidate the current IHC baseline. You'll need to
            re-verify after implementing changes. Continue?
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowWarning(false)}>Cancel</Button>
            <Button
              className="bg-[#1B2A4A] text-white hover:bg-[#1B2A4A]/90"
              onClick={() => { setShowWarning(false); setOpen(true); }}
            >
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Intent picker dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Choose a redesign approach</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 py-2">
            <IntentCard
              intent="plan_from_scratch"
              preconditions={preconditions}
              clientId={clientId}
              businessType={businessType}
              onPreconditionSaved={onPreconditionSaved}
            />
            <IntentCard
              intent="audit_existing"
              preconditions={preconditions}
              clientId={clientId}
              businessType={businessType}
              onPreconditionSaved={onPreconditionSaved}
            />
            <IntentCard
              intent="inventory"
              preconditions={preconditions}
              clientId={clientId}
              businessType={businessType}
              onPreconditionSaved={onPreconditionSaved}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
