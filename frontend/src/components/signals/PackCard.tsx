import { Link } from 'react-router-dom';
import { Package, Users } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { SignalPack } from '@/types/signal';

interface Props {
  pack: SignalPack;
  orgId: string;
}

export function PackCard({ pack, orgId }: Props) {
  return (
    <Link to={`/org/${orgId}/packs/${pack.id}`}>
      <Card className="h-full cursor-pointer transition-shadow hover:shadow-md">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 shrink-0 text-primary" />
                <p className="text-sm font-semibold truncate">{pack.name}</p>
              </div>
              {pack.description && (
                <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{pack.description}</p>
              )}
            </div>
            {pack.is_system && (
              <Badge variant="secondary" className="shrink-0 text-[10px]">System</Badge>
            )}
          </div>

          <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
            <span>{pack.signals_count} signal{pack.signals_count !== 1 ? 's' : ''}</span>
            <span>·</span>
            <span className="capitalize">{pack.business_type}</span>
            <span>·</span>
            <span>v{pack.version}</span>
          </div>

          {pack.client_count !== undefined && pack.client_count > 0 && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users className="h-3 w-3" />
              <span>{pack.client_count} client{pack.client_count !== 1 ? 's' : ''}</span>
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
