import { useNavigate } from 'react-router-dom';
import { Tag, GitBranch, Clock, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Deployment } from '@/types/tracking';

const DESIGNED_VIA_LABELS: Record<string, string> = {
  planning_mode: 'Planning Mode',
  journey_builder: 'Journey Builder',
  mixed: 'Planning Mode + Journey Builder',
};

interface TaggingSummaryCardProps {
  clientId: string;
  deployment: Deployment;
}

export function TaggingSummaryCard({ clientId, deployment }: TaggingSummaryCardProps) {
  const navigate = useNavigate();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Tag className="h-4 w-4 text-muted-foreground" />
          Tagging design
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-1.5 rounded-md border px-3 py-1.5">
            <Layers className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium">{deployment.signals_count}</span>
            <span className="text-xs text-muted-foreground">signal packs</span>
          </div>
          {deployment.stages_count > 0 && (
            <div className="flex items-center gap-1.5 rounded-md border px-3 py-1.5">
              <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium">{deployment.stages_count}</span>
              <span className="text-xs text-muted-foreground">stages</span>
            </div>
          )}
        </div>

        <div className="space-y-1 text-xs text-muted-foreground">
          {deployment.last_updated_at && (
            <div className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              <span>Last updated {new Date(deployment.last_updated_at).toLocaleDateString()}</span>
            </div>
          )}
          {deployment.designed_via && (
            <div className="flex items-center gap-1.5">
              <span>Designed via</span>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {DESIGNED_VIA_LABELS[deployment.designed_via] ?? deployment.designed_via}
              </Badge>
            </div>
          )}
        </div>

        <Button
          size="sm"
          variant="outline"
          className="w-full text-xs"
          onClick={() => navigate(`/signals?client_id=${clientId}`)}
        >
          View all signals for this client
        </Button>
      </CardContent>
    </Card>
  );
}
