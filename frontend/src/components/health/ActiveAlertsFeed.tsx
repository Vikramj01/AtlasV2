/**
 * ActiveAlertsFeed — displays active health alerts with acknowledge button.
 */

import { useState } from 'react';
import { AlertTriangle, AlertCircle, Info, CheckCircle2, X } from 'lucide-react';
import type { HealthAlert } from '@/types/health';
import { healthApi } from '@/lib/api/healthApi';

const SEVERITY_CONFIG = {
  critical: {
    icon: AlertTriangle,
    classes: 'bg-red-50 border-red-200 text-red-900',
    iconClass: 'text-red-500',
    badge: 'bg-red-100 text-red-700',
  },
  warning: {
    icon: AlertCircle,
    classes: 'bg-amber-50 border-amber-200 text-amber-900',
    iconClass: 'text-amber-500',
    badge: 'bg-amber-100 text-amber-700',
  },
  info: {
    icon: Info,
    classes: 'bg-blue-50 border-blue-200 text-blue-900',
    iconClass: 'text-blue-500',
    badge: 'bg-blue-100 text-blue-700',
  },
};

interface AlertCardProps {
  alert: HealthAlert;
  onAcknowledge: (id: string) => void;
}

function AlertCard({ alert, onAcknowledge }: AlertCardProps) {
  const [loading, setLoading] = useState(false);
  const config = SEVERITY_CONFIG[alert.severity];
  const Icon = config.icon;
  const isAcknowledged = alert.acknowledged_at !== null;

  async function handleAck() {
    setLoading(true);
    try {
      await healthApi.acknowledgeAlert(alert.id);
      onAcknowledge(alert.id);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`rounded-xl border px-4 py-3.5 ${config.classes} ${isAcknowledged ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-3">
        <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${config.iconClass}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${config.badge}`}>
              {alert.severity.toUpperCase()}
            </span>
            {isAcknowledged && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Acknowledged
              </span>
            )}
          </div>
          <p className="text-sm font-semibold">{alert.title}</p>
          <p className="text-xs mt-0.5 opacity-80 leading-relaxed">{alert.message}</p>
          <p className="text-xs mt-1.5 opacity-50">
            Triggered {new Date(alert.triggered_at).toLocaleDateString()}
          </p>
        </div>
        {!isAcknowledged && (
          <button
            type="button"
            onClick={handleAck}
            disabled={loading}
            className="shrink-0 p-1 rounded hover:bg-black/10 transition-colors"
            title="Acknowledge"
          >
            <X className="h-3.5 w-3.5 opacity-50" />
          </button>
        )}
      </div>
    </div>
  );
}

interface ActiveAlertsFeedProps {
  alerts: HealthAlert[];
}

export function ActiveAlertsFeed({ alerts }: ActiveAlertsFeedProps) {
  const [local, setLocal] = useState<HealthAlert[]>(alerts);

  function handleAcknowledge(id: string) {
    setLocal((prev) =>
      prev.map((a) => a.id === id ? { ...a, acknowledged_at: new Date().toISOString() } : a)
    );
  }

  if (local.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3.5">
        <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
        <p className="text-sm font-medium text-green-800">No active alerts — everything looks good</p>
      </div>
    );
  }

  const sorted = [...local].sort((a, b) => {
    const order = { critical: 0, warning: 1, info: 2 };
    return order[a.severity] - order[b.severity];
  });

  return (
    <div className="space-y-2">
      {sorted.map((alert) => (
        <AlertCard key={alert.id} alert={alert} onAcknowledge={handleAcknowledge} />
      ))}
    </div>
  );
}
