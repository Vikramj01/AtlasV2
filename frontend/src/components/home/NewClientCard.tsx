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
      <Card className="flex flex-col">
        <CardHeader>
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[#1B2A4A]/10">
            <ArrowRight className="h-4 w-4 text-[#1B2A4A]" />
          </div>
          <CardTitle className="mt-2">Continue tracking setup</CardTitle>
          <CardDescription>
            Pick up where you left off — scan your site, review recommendations, and deploy tracking.
          </CardDescription>
        </CardHeader>
        <CardContent className="mt-auto">
          <Button
            className="w-full bg-[#1B2A4A] hover:bg-[#1B2A4A]/90"
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
      <Card className="flex flex-col">
        <CardHeader>
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[#1B2A4A]/10">
            <Plus className="h-4 w-4 text-[#1B2A4A]" />
          </div>
          <CardTitle className="mt-2">Set up a new client</CardTitle>
          <CardDescription>
            Add a client and go straight into the AI site scan — tag everything from scratch.
          </CardDescription>
        </CardHeader>
        <CardContent className="mt-auto">
          <Button className="w-full bg-[#1B2A4A] hover:bg-[#1B2A4A]/90" onClick={() => setShowIntake(true)}>
            Add client & scan
          </Button>
        </CardContent>
      </Card>

      <QuickClientIntake orgId={org.id} open={showIntake} onOpenChange={setShowIntake} />
    </>
  );
}
