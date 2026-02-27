import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';

const PLAN_BADGE: Record<string, string> = {
  free:   'bg-gray-100 text-gray-600',
  pro:    'bg-brand-100 text-brand-700',
  agency: 'bg-purple-100 text-purple-700',
};

interface Props {
  email?: string;
  plan?: string;
}

export function TopBar({ email, plan = 'free' }: Props) {
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/login');
  };

  return (
    <header className="flex h-14 items-center justify-between border-b border-gray-200 bg-white px-6">
      <div />

      <div className="flex items-center gap-4">
        {/* Plan badge */}
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${PLAN_BADGE[plan] ?? PLAN_BADGE.free}`}>
          {plan}
        </span>

        {/* User email */}
        {email && (
          <span className="text-sm text-gray-500 hidden sm:block">{email}</span>
        )}

        {/* Sign out */}
        <button
          onClick={handleSignOut}
          className="text-sm text-gray-400 hover:text-gray-700 transition-colors"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
