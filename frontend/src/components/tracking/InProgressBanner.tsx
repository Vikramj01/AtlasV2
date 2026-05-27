import { useNavigate } from 'react-router-dom';
import { Clock, MapPin, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Module = 'planning' | 'journey' | 'crawl';

interface InProgressBannerProps {
  module: Module;
  detail: {
    id: string;
    label: string;
    resume_url: string;
  };
  onDiscard: () => void;
}

const MODULE_ICONS: Record<Module, React.ComponentType<{ className?: string }>> = {
  planning: MapPin,
  journey: Clock,
  crawl: Search,
};

const MODULE_LABELS: Record<Module, string> = {
  planning: 'Planning Mode',
  journey: 'Journey Builder',
  crawl: 'Site Scan',
};

export function InProgressBanner({ module, detail, onDiscard }: InProgressBannerProps) {
  const navigate = useNavigate();
  const Icon = MODULE_ICONS[module];

  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-amber-800">{MODULE_LABELS[module]} in progress</p>
        <p className="mt-0.5 text-xs text-amber-700 truncate">{detail.label}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-7 border-amber-300 text-amber-800 hover:bg-amber-100 text-xs"
          onClick={() => navigate(detail.resume_url)}
        >
          Resume
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-amber-600 hover:bg-amber-100 hover:text-amber-800"
          onClick={onDiscard}
          aria-label="Discard"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
