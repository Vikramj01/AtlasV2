import { Button } from '@/components/ui/button';
import type { Platform } from '@/types/connections';

const PLATFORM_LABELS: Record<Platform, string> = {
  google_ads:       'Google Ads',
  meta:             'Meta',
  ga4:              'GA4',
  gtm_destinations: 'GTM Destinations',
};

interface OAuthInitiateButtonProps {
  platform: Platform;
  clientId?: string;
  inProgress: boolean;
  onStart: (platform: Platform, clientId?: string) => void;
  variant?: 'default' | 'outline';
  size?: 'sm' | 'default';
  label?: string;
}

export function OAuthInitiateButton({
  platform,
  clientId,
  inProgress,
  onStart,
  variant = 'default',
  size = 'sm',
  label,
}: OAuthInitiateButtonProps) {
  const displayLabel = label ?? `Connect ${PLATFORM_LABELS[platform]}`;

  return (
    <Button
      variant={variant}
      size={size}
      onClick={() => onStart(platform, clientId)}
      disabled={inProgress}
      className={variant === 'default' ? 'bg-[#1B2A4A] text-white hover:bg-[#243660]' : undefined}
    >
      {inProgress ? 'Connecting…' : displayLabel}
    </Button>
  );
}
