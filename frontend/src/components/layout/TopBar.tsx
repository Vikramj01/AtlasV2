import { useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

const PLAN_BADGE_CLASS: Record<string, string> = {
  free:   'bg-zinc-100 text-zinc-600 hover:bg-zinc-100 border border-zinc-200',
  pro:    'bg-primary/10 text-primary hover:bg-primary/10 border border-primary/20',
  agency: 'bg-purple-100 text-purple-700 hover:bg-purple-100 border border-purple-200',
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
    <header className="flex h-14 items-center justify-between border-b bg-background/95 px-6 backdrop-blur supports-[backdrop-filter]:bg-background/80 shadow-[0_1px_0_0_hsl(220,13%,91%)]">
      <div />

      <div className="flex items-center gap-3">
        <Badge className={cn('capitalize text-xs font-medium', PLAN_BADGE_CLASS[plan] ?? PLAN_BADGE_CLASS.free)}>
          {plan}
        </Badge>

        {email && (
          <>
            <Separator orientation="vertical" className="h-4" />
            <span className="text-sm text-muted-foreground hidden sm:block">{email}</span>
          </>
        )}

        <Button
          variant="ghost"
          size="sm"
          onClick={handleSignOut}
          className="gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <LogOut className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Sign out</span>
        </Button>
      </div>
    </header>
  );
}
