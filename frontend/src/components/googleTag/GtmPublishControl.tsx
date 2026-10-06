// GtmPublishControl — GA4 Admin / L11 / Junk Gate PRD §A.6. Publishes an
// Atlas-deployed draft workspace to the LIVE container, only after an explicit
// confirmation, and offers a rollback of the publish it just made. A connection
// authorised before publishing was supported shows "reconnect to enable
// publishing" instead of a button that would fail.

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ihcApi } from '@/lib/api/ihcApi';
import type { GTMContainer, GtmPublishResult } from '@/types/ihc';

interface GtmPublishControlProps {
  connection: GTMContainer | undefined;
  workspaceId: string;
}

export function GtmPublishControl({ connection, workspaceId }: GtmPublishControlProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<'publish' | 'rollback' | null>(null);
  const [published, setPublished] = useState<GtmPublishResult | null>(null);
  const [rolledBack, setRolledBack] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!connection || connection.auth_method !== 'oauth') return null;

  if (connection.can_publish === false) {
    return (
      <div className="flex items-start gap-2 rounded border border-console-border p-3 text-sm text-console-fg">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-severity-warning" />
        <span>
          Publishing from Atlas is not enabled for this connection — it was authorised before publishing was supported.
          Reconnect the container under Settings → Implementation Health to enable it. You can still publish the draft in Tag Manager.
        </span>
      </div>
    );
  }

  async function publish() {
    setBusy('publish');
    setError(null);
    try {
      setPublished(await ihcApi.publishToGtm(connection!.id, workspaceId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Publish failed.');
    } finally {
      setBusy(null);
    }
  }

  async function rollback() {
    if (!published?.log_id) return;
    setBusy('rollback');
    setError(null);
    try {
      await ihcApi.rollbackGtmPublish(published.log_id);
      setRolledBack(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rollback failed.');
    } finally {
      setBusy(null);
    }
  }

  if (published) {
    return (
      <div className="space-y-2 rounded border border-console-border p-3">
        <p className="flex items-center gap-1.5 text-sm font-medium text-console-fg">
          <CheckCircle2 className="h-4 w-4 text-severity-success" />
          {rolledBack ? 'Rolled back. The previous version is live again.' : 'Published to the live container.'}
        </p>
        {!rolledBack && published.rollback_available && (
          <Button size="sm" variant="outline" onClick={rollback} disabled={busy !== null}>
            {busy === 'rollback' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Undo2 className="mr-1 h-4 w-4" />}
            Roll back to the previous version
          </Button>
        )}
        {!rolledBack && !published.rollback_available && (
          <p className="text-xs text-console-fg-muted">
            No rollback is available from Atlas for this publish (the container had no earlier live version, or the record could not be saved).
          </p>
        )}
        {error && <p className="text-sm text-severity-critical">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded border border-console-border p-3">
      <p className="text-sm font-medium text-console-fg">Publish this draft</p>
      <label className="flex items-start gap-2 text-sm text-console-fg">
        <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        <span>I understand this changes the live container immediately. Atlas records the version it replaces so this can be rolled back.</span>
      </label>
      <Button size="sm" onClick={publish} disabled={!confirmed || busy !== null}>
        {busy === 'publish' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
        Publish to live container
      </Button>
      {error && <p className="text-sm text-severity-critical">{error}</p>}
    </div>
  );
}
