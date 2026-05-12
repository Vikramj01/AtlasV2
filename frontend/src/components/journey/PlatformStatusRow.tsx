import type { LagClass } from '@/types/journey';
import { getMetaAssessment, getGoogleAssessment } from '@/lib/journey/classifyEvent';

interface PlatformStatusRowProps {
  platform: 'meta' | 'google';
  lagClass: LagClass;
}

export function PlatformStatusRow({ platform, lagClass }: PlatformStatusRowProps) {
  const assessment =
    platform === 'meta' ? getMetaAssessment(lagClass) : getGoogleAssessment(lagClass);

  const platformLabel = platform === 'meta' ? 'Meta' : 'Google';

  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="flex-shrink-0 w-14 font-medium text-foreground">{platformLabel}</span>
      <span className="flex-shrink-0">{assessment.icon}</span>
      <span className="text-muted-foreground">{assessment.copy}</span>
    </div>
  );
}
