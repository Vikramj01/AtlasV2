import type { ClientStatus } from '@/types/organisation';
import { cn } from '@/lib/utils';

interface Props {
  status: ClientStatus;
  className?: string;
}

const STATUS_CONFIG: Record<ClientStatus, { label: string; classes: string }> = {
  active: { label: 'Active', classes: 'text-green-700 bg-green-50 border-green-200' },
  paused: { label: 'Paused', classes: 'text-yellow-700 bg-yellow-50 border-yellow-200' },
  archived: { label: 'Archived', classes: 'text-gray-500 bg-gray-50 border-gray-200' },
};

export function ClientStatusBadge({ status, className }: Props) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.active;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium',
        config.classes,
        className,
      )}
    >
      {config.label}
    </span>
  );
}
