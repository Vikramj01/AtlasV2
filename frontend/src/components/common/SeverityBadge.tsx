import type { Severity } from '@/types/audit';

const STYLES: Record<Severity, string> = {
  critical: 'bg-red-100 text-red-700 border-red-200',
  high:     'bg-orange-100 text-orange-700 border-orange-200',
  medium:   'bg-yellow-100 text-yellow-700 border-yellow-200',
  low:      'bg-gray-100 text-gray-600 border-gray-200',
};

const DOT_STYLES: Record<Severity, string> = {
  critical: 'bg-red-500',
  high:     'bg-orange-500',
  medium:   'bg-yellow-400',
  low:      'bg-gray-400',
};

const LABELS: Record<Severity, string> = {
  critical: 'Critical',
  high:     'High',
  medium:   'Medium',
  low:      'Low',
};

interface Props {
  severity: Severity;
  size?: 'sm' | 'md';
}

export function SeverityBadge({ severity, size = 'md' }: Props) {
  const textSize = size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-sm px-2.5 py-1';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border font-medium ${textSize} ${STYLES[severity]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${DOT_STYLES[severity]}`} />
      {LABELS[severity]}
    </span>
  );
}
