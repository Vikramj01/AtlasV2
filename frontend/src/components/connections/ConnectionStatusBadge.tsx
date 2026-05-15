import type { ConnectionStatus } from '@/types/connections';

interface ConnectionStatusBadgeProps {
  status: ConnectionStatus;
  className?: string;
}

const CHIP: Record<ConnectionStatus, { bg: string; label: string }> = {
  active:    { bg: 'bg-green-100 text-green-700',  label: 'Active' },
  available: { bg: 'bg-gray-100 text-gray-600',    label: 'Available' },
  expired:   { bg: 'bg-amber-100 text-amber-700',  label: 'Expired' },
  revoked:   { bg: 'bg-red-100 text-red-700',      label: 'Revoked' },
  error:     { bg: 'bg-red-100 text-red-700',      label: 'Error' },
};

export function ConnectionStatusBadge({ status, className = '' }: ConnectionStatusBadgeProps) {
  const chip = CHIP[status] ?? { bg: 'bg-gray-100 text-gray-600', label: status };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${chip.bg} ${className}`}>
      {chip.label}
    </span>
  );
}
