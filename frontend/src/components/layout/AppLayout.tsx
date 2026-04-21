import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { adminApi } from '@/lib/api/adminApi';
import { useOrganisationStore } from '@/store/organisationStore';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

export function AppLayout() {
  const [email, setEmail] = useState<string>();
  const [plan, setPlan] = useState('free');
  const [isAdmin, setIsAdmin] = useState(false);
  const { currentOrg } = useOrganisationStore();

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) return;
      setEmail(session.user.email ?? undefined);

      const { data } = await supabase
        .from('profiles')
        .select('plan')
        .eq('id', session.user.id)
        .single();
      if (data?.plan) setPlan(data.plan as string);

      adminApi.check().then(() => setIsAdmin(true)).catch(() => { /* not admin */ });
    });
  }, []);

  const workspaceName = currentOrg?.name ?? undefined;

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <Sidebar isAdmin={isAdmin} />
      <div className="flex flex-1 flex-col min-w-0">
        <TopBar email={email} plan={plan} workspaceName={workspaceName} />
        <main className="flex-1 overflow-y-auto bg-white">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
