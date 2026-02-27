interface Props {
  score: number;
}

export function HealthBadge({ score }: Props) {
  const { bg, text, label } =
    score >= 80
      ? { bg: 'bg-green-100', text: 'text-green-700', label: 'Healthy' }
      : score >= 60
      ? { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'At Risk' }
      : { bg: 'bg-red-100', text: 'text-red-700', label: 'Critical' };

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-semibold ${bg} ${text}`}>
      {score}
      <span className="font-normal text-xs opacity-70">{label}</span>
    </span>
  );
}
