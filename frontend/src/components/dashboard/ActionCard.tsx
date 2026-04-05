'use client';

import { useNavigate } from 'react-router-dom';
import { AlertTriangle, AlertCircle, Info, CheckCircle2, ArrowRight, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import type { DashboardCard, CardSeverity } from '@/types/dashboard';

const SEVERITY_CONFIG: Record<CardSeverity, {
  Icon: React.ElementType;
  iconColor: string;
  border: string;
  badge: string;
  badgeText: string;
}> = {
  critical: {
    Icon: AlertTriangle,
    iconColor: 'text-red-500',
    border: 'border-red-200 hover:border-red-300',
    badge: 'bg-red-100 text-red-700',
    badgeText: 'Critical',
  },
  warning: {
    Icon: AlertCircle,
    iconColor: 'text-amber-500',
    border: 'border-amber-200 hover:border-amber-300',
    badge: 'bg-amber-100 text-amber-700',
    badgeText: 'Warning',
  },
  info: {
    Icon: Info,
    iconColor: 'text-blue-500',
    border: 'border-blue-200 hover:border-blue-300',
    badge: 'bg-blue-100 text-blue-700',
    badgeText: 'Info',
  },
  success: {
    Icon: CheckCircle2,
    iconColor: 'text-green-500',
    border: 'border-green-200 hover:border-green-300',
    badge: 'bg-green-100 text-green-700',
    badgeText: 'Healthy',
  },
};

interface ActionCardProps {
  card: DashboardCard;
}

export function ActionCard({ card }: ActionCardProps) {
  const navigate = useNavigate();
  const config = SEVERITY_CONFIG[card.severity];
  const { Icon } = config;

  return (
    <Card
      className={cn(
        'cursor-pointer transition-all duration-150 hover:shadow-md',
        config.border,
      )}
      onClick={() => navigate(card.action_url)}
    >
      <CardContent className="p-5 flex items-start gap-4">
        {/* Icon */}
        <div className="shrink-0 mt-0.5">
          <Icon className={cn('h-5 w-5', config.iconColor)} strokeWidth={2} />
        </div>

        {/* Body */}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground">{card.title}</span>
            <span className={cn('text-[11px] font-semibold px-1.5 py-0.5 rounded-full', config.badge)}>
              {config.badgeText}
            </span>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">{card.message}</p>
        </div>

        {/* Metric + CTA */}
        <div className="shrink-0 flex flex-col items-end gap-2">
          {card.metric_value !== null && (
            <div className="flex items-center gap-1 text-foreground">
              <TrendingUp className="h-3.5 w-3.5 text-muted-foreground/60" />
              <span className="text-base font-bold tabular-nums">
                {Number.isInteger(card.metric_value)
                  ? `${card.metric_value}%`
                  : card.metric_value.toFixed(1)}
              </span>
            </div>
          )}
          <div className="flex items-center gap-1 text-xs font-medium text-primary">
            {card.action_label}
            <ArrowRight className="h-3.5 w-3.5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
