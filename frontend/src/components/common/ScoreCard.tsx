interface Props {
  title: string;
  value: string | number;
  description: string;
  tooltip?: string;
  valueColor?: 'green' | 'yellow' | 'red' | 'default';
}

const VALUE_COLOR: Record<string, string> = {
  green:   'text-green-600',
  yellow:  'text-yellow-500',
  red:     'text-red-600',
  default: 'text-gray-900',
};

export function ScoreCard({ title, value, description, tooltip, valueColor = 'default' }: Props) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-gray-500">{title}</p>
        {tooltip && (
          <span
            title={tooltip}
            className="cursor-help text-gray-300 hover:text-gray-400 select-none text-base leading-none"
            aria-label={tooltip}
          >
            ⓘ
          </span>
        )}
      </div>
      <p className={`mt-2 text-3xl font-bold tracking-tight ${VALUE_COLOR[valueColor]}`}>{value}</p>
      <p className="mt-1.5 text-sm text-gray-500">{description}</p>
    </div>
  );
}
