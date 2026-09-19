// StageLadderEditor — the ladder itself (PRD §12). Per stage: CRM stage
// label, Atlas event name, resolved value + source badge + confidence,
// destination conversion IDs, and outcomes delivered in the last 30 days
// (always 0 until Sprint 4/5's orchestrator/delivery exist — a real query
// against crm_outcome_events, not a fabricated placeholder — Implementation
// Rule 12).

import { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { useCrmStore } from '@/store/crmStore';
import type { CrmSyncConfig, StageMappingRow, ValueSource } from '@/types/crm';

interface StageLadderEditorProps {
  config: CrmSyncConfig;
}

const SOURCE_BADGE: Record<ValueSource, string> = {
  DECLARED: 'bg-severity-info-bg text-severity-info',
  DERIVED: 'bg-severity-warning-bg text-severity-warning',
  CRM_AMOUNT: 'bg-severity-success-bg text-severity-success',
  NONE: 'bg-console-chip text-console-fg-muted',
};

function ValueBadge({ row }: { row: StageMappingRow }) {
  const { resolved_value } = row;
  return (
    <div className="flex flex-col gap-0.5">
      <span className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${SOURCE_BADGE[resolved_value.value_source]}`}>
        {resolved_value.value_source}
      </span>
      <span className="text-xs text-console-fg">
        {resolved_value.value != null ? `${resolved_value.value} ${resolved_value.currency ?? ''}` : '—'}
      </span>
      {resolved_value.derived_confidence && (
        <span className="text-[10px] text-console-fg-muted">confidence: {resolved_value.derived_confidence}</span>
      )}
    </div>
  );
}

export function StageLadderEditor({ config }: StageLadderEditorProps) {
  const { stageMappings, loading, errors, loadStageMappings, saveStageMappings } = useCrmStore();
  const [rows, setRows] = useState<StageMappingRow[]>([]);
  const [dirty, setDirty] = useState(false);

  const loadKey = `stage-mappings-${config.id}`;
  const saveKey = `stage-mappings-save-${config.id}`;
  const loadingRows = loading[loadKey] ?? false;
  const saving = loading[saveKey] ?? false;
  const saveError = errors[saveKey];
  const response = stageMappings[config.id];

  useEffect(() => {
    loadStageMappings(config.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.id]);

  useEffect(() => {
    if (response) {
      setRows(response.mappings);
      setDirty(false);
    }
  }, [response]);

  function updateRow(index: number, patch: Partial<StageMappingRow>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    setDirty(true);
  }

  async function handleSave() {
    await saveStageMappings(
      config.id,
      rows.map((r) => ({
        crm_stage_id: r.crm_stage_id,
        crm_stage_label: r.crm_stage_label,
        stage_order: r.stage_order,
        atlas_event_name: r.atlas_event_name,
        is_terminal_won: r.is_terminal_won,
        is_terminal_lost: r.is_terminal_lost,
        declared_value: r.declared_value,
        currency: r.currency,
        google_conversion_action_id: r.google_conversion_action_id,
        meta_event_name: r.meta_event_name,
        linkedin_conversion_id: r.linkedin_conversion_id,
        enabled: r.enabled,
      })),
    ).catch(() => { /* surfaced via errors[] */ });
  }

  return (
    <Card className="border-console-border bg-console-surface">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base text-console-fg">Signal Ladder</CardTitle>
          <p className="text-sm text-console-fg-muted">
            {response?.is_draft
              ? 'Suggested from the connected pipeline — review and save to activate.'
              : 'One conversion action per stage. Values resolve as shown at delivery time.'}
          </p>
        </div>
        <Button size="sm" onClick={handleSave} disabled={saving || loadingRows || rows.length === 0}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
          Save ladder
        </Button>
      </CardHeader>
      <CardContent>
        {loadingRows ? (
          <div className="flex items-center gap-2 text-sm text-console-fg-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading the ladder…
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-console-fg-muted">No pipeline stages found to build a ladder from.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>CRM stage</TableHead>
                  <TableHead>Atlas event name</TableHead>
                  <TableHead>Won / Lost</TableHead>
                  <TableHead>Declared value</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead>Resolved value</TableHead>
                  <TableHead>Google conv. ID</TableHead>
                  <TableHead>Meta event</TableHead>
                  <TableHead>LinkedIn conv. ID</TableHead>
                  <TableHead>Outcomes (30d)</TableHead>
                  <TableHead>Enabled</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, i) => (
                  <TableRow key={row.crm_stage_id}>
                    <TableCell className="text-sm text-console-fg whitespace-nowrap">{row.crm_stage_label || row.crm_stage_id}</TableCell>
                    <TableCell>
                      <Input
                        className="h-8 w-40"
                        value={row.atlas_event_name}
                        onChange={(e) => updateRow(i, { atlas_event_name: e.target.value })}
                      />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <label className="flex items-center gap-1 text-xs">
                        <Checkbox checked={row.is_terminal_won} onCheckedChange={(v) => updateRow(i, { is_terminal_won: v === true, is_terminal_lost: v === true ? false : row.is_terminal_lost })} />
                        Won
                      </label>
                      <label className="flex items-center gap-1 text-xs mt-1">
                        <Checkbox checked={row.is_terminal_lost} onCheckedChange={(v) => updateRow(i, { is_terminal_lost: v === true, is_terminal_won: v === true ? false : row.is_terminal_won })} />
                        Lost
                      </label>
                    </TableCell>
                    <TableCell>
                      <Input
                        className="h-8 w-24"
                        type="number"
                        min={0}
                        value={row.declared_value ?? ''}
                        onChange={(e) => updateRow(i, { declared_value: e.target.value === '' ? null : Number(e.target.value) })}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        className="h-8 w-16"
                        maxLength={3}
                        value={row.currency ?? ''}
                        placeholder={config.default_currency}
                        onChange={(e) => updateRow(i, { currency: e.target.value.toUpperCase() || null })}
                      />
                    </TableCell>
                    <TableCell><ValueBadge row={row} /></TableCell>
                    <TableCell>
                      <Input
                        className="h-8 w-32"
                        value={row.google_conversion_action_id ?? ''}
                        onChange={(e) => updateRow(i, { google_conversion_action_id: e.target.value || null })}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        className="h-8 w-28"
                        value={row.meta_event_name ?? ''}
                        onChange={(e) => updateRow(i, { meta_event_name: e.target.value || null })}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        className="h-8 w-32"
                        value={row.linkedin_conversion_id ?? ''}
                        onChange={(e) => updateRow(i, { linkedin_conversion_id: e.target.value || null })}
                      />
                    </TableCell>
                    <TableCell className="text-sm text-console-fg-muted text-center">{row.outcomes_last_30d}</TableCell>
                    <TableCell>
                      <Checkbox checked={row.enabled} onCheckedChange={(v) => updateRow(i, { enabled: v === true })} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {saveError && <p className="mt-3 text-sm text-severity-critical">{saveError}</p>}
        {dirty && !saving && <p className="mt-3 text-xs text-console-fg-muted">Unsaved changes.</p>}
      </CardContent>
    </Card>
  );
}
