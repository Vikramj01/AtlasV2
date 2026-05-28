import { Navigate } from 'react-router-dom';
import { useOrganisationStore } from '@/store/organisationStore';

interface BrandRedirectGuardProps {
  children: React.ReactNode;
}

/**
 * Redirects brand-type orgs away from the Clients list to their primary client's
 * tracking hub. Agency orgs and users without an org pass through unchanged.
 */
export function BrandRedirectGuard({ children }: BrandRedirectGuardProps) {
  const { currentOrg } = useOrganisationStore();

  if (currentOrg?.org_type === 'brand' && currentOrg?.primary_client_id) {
    return <Navigate to={`/clients/${currentOrg.primary_client_id}/tracking`} replace />;
  }

  return <>{children}</>;
}
