'use client';

import { useNavigate } from 'react-router-dom';
import { MapPin, CheckCircle, Search, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RouterButtonProps {
  Icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  label: string;
  description: string;
  ctaColor: string;
  onClick: () => void;
}

function RouterButton({ Icon, iconBg, iconColor, label, description, ctaColor, onClick }: RouterButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'group flex items-center gap-4 rounded-xl border bg-background px-5 py-4',
        'w-full text-left transition-all duration-150 hover:shadow-md hover:border-primary/20',
      )}
    >
      <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', iconBg)}>
        <Icon className={cn('h-5 w-5', iconColor)} strokeWidth={2} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      <ArrowRight
        className={cn(
          'h-4 w-4 shrink-0 transition-all duration-150 group-hover:translate-x-0.5',
          ctaColor,
        )}
      />
    </button>
  );
}

/**
 * IntelligentRouter — always-visible entry points below the action cards.
 * Three task-oriented paths: set up tracking, verify journeys, quick scan.
 */
export function IntelligentRouter({ className }: { className?: string }) {
  const navigate = useNavigate();

  return (
    <div className={cn('space-y-2', className)}>
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60 px-1">
        Get started
      </p>

      <RouterButton
        Icon={MapPin}
        iconBg="bg-primary/10"
        iconColor="text-primary"
        label="Set up tracking on a site"
        description="Scan a URL with AI and get a GTM container + implementation guide ready to deploy."
        ctaColor="text-primary"
        onClick={() => navigate('/planning/new')}
      />

      <RouterButton
        Icon={CheckCircle}
        iconBg="bg-amber-100"
        iconColor="text-amber-600"
        label="Check if tracking works"
        description="Validate your live tracking against 26 rules across GA4, Meta, Google Ads, and sGTM."
        ctaColor="text-amber-600"
        onClick={() => navigate('/journey/new')}
      />

      <RouterButton
        Icon={Search}
        iconBg="bg-emerald-100"
        iconColor="text-emerald-600"
        label="Scan a URL quickly"
        description="Run a fast tag scan on any page to identify tracking implementations in seconds."
        ctaColor="text-emerald-600"
        onClick={() => navigate('/planning/new')}
      />
    </div>
  );
}
