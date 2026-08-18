import { useEffect, useState } from 'react';
import { organisationApi } from '@/lib/api/organisationApi';
import { useOrganisationStore } from '@/store/organisationStore';

/**
 * Fetches the caller's organisations if the store doesn't already have them.
 * Used by HomePage to decide first-time vs returning-user rendering before
 * paint — gates on its own load rather than assuming Sidebar's independent
 * fetch has already populated the store (both mount concurrently).
 */
export function useOrganisations() {
  const { organisations, setOrganisations } = useOrganisationStore();
  const [loading, setLoading] = useState(organisations.length === 0);

  useEffect(() => {
    if (organisations.length > 0) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    organisationApi.list()
      .then((orgs) => { if (!cancelled) setOrganisations(orgs); })
      .catch(() => { /* non-blocking — treated as zero orgs */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return { organisations, loading };
}
