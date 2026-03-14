import { Link } from 'react-router-dom';
import { ExternalLink, Package } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { ClientWithDetails } from '@/types/organisation';

interface Props {
  client: ClientWithDetails;
  orgId: string;
}

function HealthBadge({ score }: { score: number | null | undefined }) {
  if (score === null || score === undefined) {
    return <span className="text-xs text-muted-foreground">Not audited</span>;
  }
  const color = score >= 80 ? 'text-green-700 bg-green-50 border-green-200'
    : score >= 60 ? 'text-yellow-700 bg-yellow-50 border-yellow-200'
    : 'text-red-700 bg-red-50 border-red-200';
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${color}`}>
      {score}/100
    </span>
  );
}

export function ClientCard({ client, orgId }: Props) {
  return (
    <Link to={`/org/${orgId}/clients/${client.id}`}>
      <Card className="h-full transition-shadow hover:shadow-md cursor-pointer">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{client.name}</p>
              <a
                href={client.website_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-0.5 w-fit"
              >
                <span className="truncate max-w-[140px]">{client.website_url.replace(/^https?:\/\//, '')}</span>
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            </div>
            <HealthBadge score={client.signal_health} />
          </div>

          <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
            <Badge variant="outline" className="text-[10px]">{client.business_type}</Badge>
            {client.detected_platform && (
              <span className="capitalize">{client.detected_platform}</span>
            )}
          </div>

          {(client.deployment_count ?? 0) > 0 && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Package className="h-3 w-3" />
              <span>{client.deployment_count} pack{client.deployment_count !== 1 ? 's' : ''} deployed</span>
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
