import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

const PLAN_BADGE_CLASS: Record<string, string> = {
  free:   'bg-gray-100 text-gray-600 hover:bg-gray-100',
  pro:    'bg-brand-100 text-brand-700 hover:bg-brand-100',
  agency: 'bg-purple-100 text-purple-700 hover:bg-purple-100',
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
    <header className="flex h-14 items-center justify-between border-b bg-background px-6">
      <div />

      <div className="flex items-center gap-3">
        <Badge className={cn('capitalize', PLAN_BADGE_CLASS[plan] ?? PLAN_BADGE_CLASS.free)}>
          {plan}
        </Badge>

        {email && (
          <>
            <Separator orientation="vertical" className="h-4" />
            <span className="text-sm text-muted-foreground hidden sm:block">{email}</span>
          </>
        )}

        <Button variant="ghost" size="sm" onClick={handleSignOut} className="text-muted-foreground">
          Sign out
        </Button>
      </div>
    </header>
  );
}
