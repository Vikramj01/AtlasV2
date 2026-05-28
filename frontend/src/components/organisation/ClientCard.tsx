import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Package, BookmarkPlus, Check } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { clientApi } from '@/lib/api/organisationApi';
import { ClientStatusBadge } from './ClientStatusBadge';
import type { ClientWithDetails } from '@/types/organisation';

interface Props {
  client: ClientWithDetails;
  orgId: string;
  onTemplateSaved?: () => void;
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

export function ClientCard({ client, orgId, onTemplateSaved }: Props) {
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [templateName, setTemplateName] = useState(`${client.name} template`);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function handleSaveAsTemplate() {
    setIsSaving(true);
    setSaveError(null);
    try {
      await clientApi.saveAsAgencyTemplate(orgId, client.id, { name: templateName.trim() });
      setSaved(true);
      setTimeout(() => {
        setShowTemplateDialog(false);
        setSaved(false);
        setTemplateName(`${client.name} template`);
        onTemplateSaved?.();
      }, 1200);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save template');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <div className="group relative">
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
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {client.status !== 'active' && <ClientStatusBadge status={client.status} />}
                  {client.timing_risk_flag === 'flagged' && (
                    <span
                      title="This client has conversion events with unresolved signal timing risk"
                      className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700"
                    >
                      ⏱ Timing risk
                    </span>
                  )}
                  <HealthBadge score={client.signal_health} />
                </div>
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

              {client.template_source_pack_id && (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <BookmarkPlus className="h-3 w-3" />
                  <span>From template</span>
                </div>
              )}
              {client.template_source_client_id && (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <BookmarkPlus className="h-3 w-3" />
                  <span>Copied from client</span>
                </div>
              )}
            </CardContent>
          </Card>
        </Link>

        {/* Save as template button — appears on hover */}
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); setShowTemplateDialog(true); }}
          className="absolute top-2 right-2 hidden group-hover:flex items-center gap-1 rounded-md bg-white border border-border px-1.5 py-1 text-[10px] font-medium text-muted-foreground shadow-sm hover:text-foreground hover:border-foreground/30 transition-all"
          title="Save as agency template"
        >
          <BookmarkPlus className="h-3 w-3" />
          Save as template
        </button>
      </div>

      <Dialog open={showTemplateDialog} onOpenChange={setShowTemplateDialog}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="text-base">Save as agency template</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-xs text-muted-foreground">
              This will save {client.name}&apos;s deployed signal packs as a reusable template for future clients.
            </p>
            <div className="space-y-1">
              <Label htmlFor="template-name" className="text-xs">Template name</Label>
              <Input
                id="template-name"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                className="text-sm"
                maxLength={100}
              />
            </div>
            {saveError && (
              <p className="text-xs text-red-600 bg-red-50 rounded px-2 py-1">{saveError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setShowTemplateDialog(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSaveAsTemplate}
              disabled={isSaving || !templateName.trim() || saved}
            >
              {saved ? (
                <><Check className="h-3.5 w-3.5 mr-1.5" /> Saved</>
              ) : isSaving ? 'Saving…' : 'Save template'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
