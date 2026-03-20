import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { adminApi } from '@/lib/api/adminApi';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

export function AppLayout() {
  const [email, setEmail] = useState<string>();
  const [plan, setPlan] = useState('free');
  const [isAdmin, setIsAdmin] = useState(false);

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

      // Check admin access silently — 403 just means not an admin
      adminApi.check().then(() => setIsAdmin(true)).catch(() => { /* not admin */ });
    });
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar isAdmin={isAdmin} />
      <div className="flex flex-1 flex-col min-w-0">
        <TopBar email={email} plan={plan} />
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
