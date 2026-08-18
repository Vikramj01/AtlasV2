import { useNavigate } from 'react-router-dom';
import { CreateOrgForm } from '@/components/organisation/CreateOrgForm';
import type { Organisation } from '@/types/organisation';

/**
 * First-time landing — shown at "/" when the signed-in user belongs to no
 * organisation yet. Once an org exists, HomePage always renders
 * ReturningUserLanding instead, regardless of how much onboarding-checklist
 * work is still outstanding (see HomePage.tsx).
 */
export function FirstTimeSetup() {
  const navigate = useNavigate();

  function handleCreated(org: Organisation) {
    if (org.org_type === 'brand' && org.primary_client_id) {
      navigate(`/clients/${org.primary_client_id}/tracking`);
    } else {
      navigate('/');
    }
  }

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col justify-center px-6 py-16">
      <div className="mb-6 text-center">
        <h1 className="text-xl font-bold">Welcome to Atlas</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Set up your workspace to get started.
        </p>
      </div>
      <div className="rounded-xl border bg-background p-6">
        <CreateOrgForm onCreated={handleCreated} submitLabel="Get started" />
      </div>
    </div>
  );
}
