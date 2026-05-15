import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';

interface RediscoverButtonProps {
  connectionId: string;
  isLoading: boolean;
  onRediscover: (connectionId: string) => void;
}

export function RediscoverButton({ connectionId, isLoading, onRediscover }: RediscoverButtonProps) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => onRediscover(connectionId)}
      disabled={isLoading}
      className="gap-1.5"
    >
      <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
      {isLoading ? 'Scanning…' : 'Re-scan accounts'}
    </Button>
  );
}
