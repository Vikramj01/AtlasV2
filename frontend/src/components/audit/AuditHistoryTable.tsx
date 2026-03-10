import { Link } from 'react-router-dom';
import { HealthBadge } from '@/components/common/HealthBadge';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { AuditStatus } from '@/types/audit';

export interface AuditHistoryItem {
  id: string;
  website_url: string;
  created_at: string;
  status: AuditStatus;
  signal_health?: number;
  attribution_risk?: string;
}

const STATUS_BADGE: Record<AuditStatus, { label: string; cls: string }> = {
  queued:    { label: 'Queued',   cls: 'bg-gray-100 text-gray-600 hover:bg-gray-100' },
  running:   { label: 'Running',  cls: 'bg-blue-100 text-blue-700 hover:bg-blue-100' },
  completed: { label: 'Complete', cls: 'bg-green-100 text-green-700 hover:bg-green-100' },
  failed:    { label: 'Failed',   cls: 'bg-red-100 text-red-700 hover:bg-red-100' },
};

interface Props {
  audits: AuditHistoryItem[];
  loading: boolean;
}

export function AuditHistoryTable({ audits, loading }: Props) {
  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        Loading audit history…
      </div>
    );
  }

  if (audits.length === 0) {
    return (
      <div className="flex h-32 flex-col items-center justify-center gap-1 text-sm text-muted-foreground">
        <span>No audits yet.</span>
        <span>Run your first audit above to get started.</span>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            {['Website', 'Date', 'Signal Health', 'Attribution Risk', 'Status', ''].map((h) => (
              <TableHead key={h}>{h}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {audits.map((audit) => {
            const s = STATUS_BADGE[audit.status];
            const domain = (() => {
              try { return new URL(audit.website_url).hostname; }
              catch { return audit.website_url; }
            })();

            return (
              <TableRow key={audit.id}>
                <TableCell className="font-medium max-w-xs truncate">{domain}</TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {new Date(audit.created_at).toLocaleDateString()}
                </TableCell>
                <TableCell>
                  {audit.signal_health != null ? (
                    <HealthBadge score={audit.signal_health} />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {audit.attribution_risk ? (
                    <span>{audit.attribution_risk}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge className={s.cls}>{s.label}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  {audit.status === 'completed' && (
                    <Link
                      to={`/report/${audit.id}`}
                      className="text-sm font-medium text-brand-600 hover:text-brand-700"
                    >
                      View →
                    </Link>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
