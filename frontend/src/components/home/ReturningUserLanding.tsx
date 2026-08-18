import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useOrganisationStore } from '@/store/organisationStore';
import { EvaluateSiteCard } from '@/components/home/EvaluateSiteCard';
import { NewClientCard } from '@/components/home/NewClientCard';

function getTimeOfDayGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * The returning-user landing at "/" — two front-and-center choices, nothing
 * else. Everything the old HomePage surfaced here (score tiles, next-action
 * card, recent activity) lives on /dashboard instead, reachable from the
 * sidebar rather than duplicated on this page.
 */
export function ReturningUserLanding() {
  const currentOrg = useOrganisationStore((s) => s.currentOrg);
  const [firstName, setFirstName] = useState('');

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const fullName = (data.user?.user_metadata?.full_name as string | undefined) ?? '';
      setFirstName(fullName.split(' ')[0] ?? '');
    });
  }, []);

  if (!currentOrg) return null;

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <div className="mb-8">
        <h1 className="text-page-title">
          {getTimeOfDayGreeting()}{firstName ? `, ${firstName}` : ''}.
        </h1>
        <p className="mt-1 text-body text-[#6B7280]">What would you like to do?</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <EvaluateSiteCard />
        <NewClientCard org={currentOrg} />
      </div>

      <p className="mt-8 text-center text-xs text-muted-foreground">
        Looking for something else? <Link to="/dashboard" className="font-medium text-[#1B2A4A] hover:underline">Go to your dashboard →</Link>
      </p>
    </div>
  );
}
