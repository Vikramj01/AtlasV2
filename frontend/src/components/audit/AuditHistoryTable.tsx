import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Trash2, Check, X } from 'lucide-react';
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
  onDelete?: (id: string) => void;
}

export function AuditHistoryTable({ audits, loading, onDelete }: Props) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleConfirmDelete(id: string) {
    if (!onDelete) return;
    setDeletingId(id);
    setConfirmId(null);
    await onDelete(id);
    setDeletingId(null);
  }

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
              <TableRow key={audit.id} className={deletingId === audit.id ? 'opacity-50' : ''}>
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
                  <div className="flex items-center justify-end gap-3">
                    {audit.status === 'completed' && (
                      <Link
                        to={`/report/${audit.id}`}
                        className="text-sm font-medium text-[#1B2A4A] hover:text-[#1B2A4A]"
                      >
                        View →
                      </Link>
                    )}
                    {onDelete && (
                      confirmId === audit.id ? (
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span>Delete?</span>
                          <button
                            onClick={() => handleConfirmDelete(audit.id)}
                            className="rounded p-0.5 text-red-600 hover:bg-red-50"
                            title="Confirm delete"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setConfirmId(null)}
                            className="rounded p-0.5 text-muted-foreground hover:bg-accent"
                            title="Cancel"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmId(audit.id)}
                          disabled={deletingId === audit.id}
                          className="rounded p-1 text-muted-foreground/50 hover:bg-red-50 hover:text-red-500 transition-colors"
                          title="Delete audit"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
