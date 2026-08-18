import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { QuickClientIntake } from '@/components/organisation/QuickClientIntake';
import type { Organisation } from '@/types/organisation';

interface Props {
  org: Organisation;
}

const SETUP_STEPS = [
  { n: 1, label: 'Add client name & primary domain' },
  { n: 2, label: 'Confirm funnel type & tracking goals' },
  { n: 3, label: 'Run the first AI site scan' },
];

function StepRow({ n, label }: { n: number; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border border-console-border font-mono text-[11px] text-console-fg-subtle">
        {n}
      </span>
      <span className="text-sm text-console-fg-muted">{label}</span>
    </div>
  );
}

/**
 * "Set up a new client" — slim intake straight into the AI site scan. Brand
 * orgs are auto-collapsed to a single primary client (see Sidebar's "My
 * Tracking" nav), so this card relabels to continuing that client's setup
 * instead of offering to create another one.
 */
export function NewClientCard({ org }: Props) {
  const navigate = useNavigate();
  const [showIntake, setShowIntake] = useState(false);

  if (org.org_type === 'brand' && org.primary_client_id) {
    return (
      <Card className="flex flex-col rounded-[10px] border-console-border bg-console-surface">
        <CardHeader className="p-7">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-console-primary/20 bg-console-primary/10">
            <ArrowRight className="h-[19px] w-[19px] text-console-primary" strokeWidth={1.75} />
          </div>
          <CardTitle className="mt-2.5 font-heading text-xl font-bold text-console-fg">Continue tracking setup</CardTitle>
          <CardDescription className="text-console-fg-muted leading-relaxed">
            Pick up where you left off — scan your site, review recommendations, and deploy tracking.
          </CardDescription>
        </CardHeader>
        <CardContent className="mt-auto p-7 pt-0">
          <Button
            className="w-full bg-console-primary font-heading font-bold hover:bg-console-primary-hover shadow-console-glow"
            onClick={() => navigate(`/clients/${org.primary_client_id}/tracking`)}
          >
            Go to my tracking setup
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="flex flex-col rounded-[10px] border-console-border bg-console-surface">
        <CardHeader className="p-7">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-console-primary/20 bg-console-primary/10">
            <Plus className="h-[19px] w-[19px] text-console-primary" strokeWidth={1.75} />
          </div>
          <CardTitle className="mt-2.5 font-heading text-xl font-bold text-console-fg">Set up a new client</CardTitle>
          <CardDescription className="text-console-fg-muted leading-relaxed">
            Add a client and go straight into the AI site scan — tag everything from scratch.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col p-7 pt-0">
          <div className="flex flex-1 flex-col justify-center gap-3.5 py-5">
            {SETUP_STEPS.map((step) => (
              <StepRow key={step.n} n={step.n} label={step.label} />
            ))}
          </div>
          <Button
            className="w-full bg-console-primary font-heading font-bold hover:bg-console-primary-hover shadow-console-glow"
            onClick={() => setShowIntake(true)}
          >
            Add client & scan
          </Button>
        </CardContent>
      </Card>

      <QuickClientIntake orgId={org.id} open={showIntake} onOpenChange={setShowIntake} />
    </>
  );
}
