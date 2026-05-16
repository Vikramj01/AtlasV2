import { useEffect, useState } from 'react';
import { Settings2, Plus, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useReconciliationStore } from '@/store/reconciliationStore';
import type { ToleranceConfig, UpsertToleranceInput } from '@/lib/api/reconciliationApi';
import { reconciliationApi } from '@/lib/api/reconciliationApi';

interface Props {
  clientId: string;
}

interface EditRow {
  id?: string;
  event_name: string | null;
  platform: string | null;
  volume_tolerance_pct: number;
  dedup_warn_threshold: number;
  enabled: boolean;
  editing: boolean;
}

function configToEditRow(c: ToleranceConfig): EditRow {
  return {
    id: c.id,
    event_name: c.event_name,
    platform: c.platform,
    volume_tolerance_pct: c.volume_tolerance_pct,
    dedup_warn_threshold: c.dedup_warn_threshold,
    enabled: c.enabled,
    editing: false,
  };
}

function rowLabel(row: EditRow): string {
  if (!row.event_name && !row.platform) return 'Client-wide default';
  if (!row.platform) return `Event: ${row.event_name}`;
  if (!row.event_name) return `Platform: ${row.platform}`;
  return `${row.event_name} / ${row.platform}`;
}

export function ToleranceConfigPanel({ clientId }: Props) {
  const { toleranceConfigs, fetchTolerance } = useReconciliationStore();
  const [rows, setRows] = useState<EditRow[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [newRow, setNewRow] = useState<Omit<EditRow, 'id' | 'editing'>>({
    event_name: null,
    platform: null,
    volume_tolerance_pct: 20,
    dedup_warn_threshold: 0.7,
    enabled: true,
  });

  useEffect(() => {
    fetchTolerance(clientId);
  }, [clientId, fetchTolerance]);

  useEffect(() => {
    setRows(toleranceConfigs.map(configToEditRow));
  }, [toleranceConfigs]);

  async function handleSave(row: EditRow) {
    const key = row.id ?? 'new';
    setSaving(key);
    try {
      const body: UpsertToleranceInput = {
        clientId,
        eventName: row.event_name,
        platform: row.platform,
        volumeTolerancePct: row.volume_tolerance_pct,
        dedupWarnThreshold: row.dedup_warn_threshold,
        enabled: row.enabled,
      };
      await reconciliationApi.upsertTolerance(body);
      await fetchTolerance(clientId);
      setRows((prev) => prev.map((r) => r.id === row.id ? { ...r, editing: false } : r));
    } finally {
      setSaving(null);
    }
  }

  async function handleAddNew() {
    setSaving('new');
    try {
      await reconciliationApi.upsertTolerance({ clientId, ...newRow });
      await fetchTolerance(clientId);
      setAddingNew(false);
      setNewRow({ event_name: null, platform: null, volume_tolerance_pct: 20, dedup_warn_threshold: 0.7, enabled: true });
    } finally {
      setSaving(null);
    }
  }

  function updateRow(id: string | undefined, patch: Partial<EditRow>) {
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, ...patch } : r));
  }

  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-[#6B7280]" />
          <p className="text-xs font-semibold uppercase tracking-wide text-[#9CA3AF]">Volume tolerances</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setAddingNew(true)}
          className="gap-1.5 text-xs h-7"
        >
          <Plus className="h-3 w-3" />
          Add rule
        </Button>
      </div>

      {rows.length === 0 && !addingNew && (
        <p className="text-xs text-[#9CA3AF] text-center py-4">
          No tolerance rules configured — using default 20% threshold for all events.
        </p>
      )}

      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.id} className="rounded-lg border border-[#E5E7EB] p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[#1B2A4A]">{rowLabel(row)}</span>
              {!row.editing ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => updateRow(row.id, { editing: true })}
                  className="h-6 text-xs px-2"
                >
                  Edit
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleSave(row)}
                  disabled={saving === row.id}
                  className="h-6 text-xs px-2 gap-1"
                >
                  <Save className="h-3 w-3" />
                  {saving === row.id ? 'Saving…' : 'Save'}
                </Button>
              )}
            </div>

            {row.editing ? (
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-0.5">
                  <span className="text-[10px] text-[#6B7280]">Volume tolerance (%)</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={row.volume_tolerance_pct}
                    onChange={(e) => updateRow(row.id, { volume_tolerance_pct: parseFloat(e.target.value) })}
                    className="w-full rounded border border-[#D1D5DB] px-2 py-1 text-xs text-[#1B2A4A] focus:outline-none focus:ring-1 focus:ring-[#1B2A4A]"
                  />
                </label>
                <label className="space-y-0.5">
                  <span className="text-[10px] text-[#6B7280]">Dedup warn threshold</span>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={row.dedup_warn_threshold}
                    onChange={(e) => updateRow(row.id, { dedup_warn_threshold: parseFloat(e.target.value) })}
                    className="w-full rounded border border-[#D1D5DB] px-2 py-1 text-xs text-[#1B2A4A] focus:outline-none focus:ring-1 focus:ring-[#1B2A4A]"
                  />
                </label>
              </div>
            ) : (
              <div className="flex gap-4 text-xs text-[#6B7280]">
                <span>Volume: <strong className="text-[#1B2A4A]">{row.volume_tolerance_pct}%</strong></span>
                <span>Dedup warn: <strong className="text-[#1B2A4A]">{row.dedup_warn_threshold}</strong></span>
                <span className={row.enabled ? 'text-green-600' : 'text-[#9CA3AF]'}>
                  {row.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
            )}
          </div>
        ))}

        {addingNew && (
          <div className="rounded-lg border border-[#1B2A4A]/20 bg-[#F9FAFB] p-3 space-y-2">
            <p className="text-xs font-medium text-[#1B2A4A]">New rule</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-0.5">
                <span className="text-[10px] text-[#6B7280]">Event name (blank = all)</span>
                <input
                  type="text"
                  placeholder="e.g. purchase"
                  value={newRow.event_name ?? ''}
                  onChange={(e) => setNewRow((n) => ({ ...n, event_name: e.target.value || null }))}
                  className="w-full rounded border border-[#D1D5DB] px-2 py-1 text-xs text-[#1B2A4A] focus:outline-none focus:ring-1 focus:ring-[#1B2A4A]"
                />
              </label>
              <label className="space-y-0.5">
                <span className="text-[10px] text-[#6B7280]">Platform (blank = all)</span>
                <input
                  type="text"
                  placeholder="e.g. google_ads"
                  value={newRow.platform ?? ''}
                  onChange={(e) => setNewRow((n) => ({ ...n, platform: e.target.value || null }))}
                  className="w-full rounded border border-[#D1D5DB] px-2 py-1 text-xs text-[#1B2A4A] focus:outline-none focus:ring-1 focus:ring-[#1B2A4A]"
                />
              </label>
              <label className="space-y-0.5">
                <span className="text-[10px] text-[#6B7280]">Volume tolerance (%)</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={newRow.volume_tolerance_pct}
                  onChange={(e) => setNewRow((n) => ({ ...n, volume_tolerance_pct: parseFloat(e.target.value) }))}
                  className="w-full rounded border border-[#D1D5DB] px-2 py-1 text-xs text-[#1B2A4A] focus:outline-none focus:ring-1 focus:ring-[#1B2A4A]"
                />
              </label>
              <label className="space-y-0.5">
                <span className="text-[10px] text-[#6B7280]">Dedup warn threshold</span>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={newRow.dedup_warn_threshold}
                  onChange={(e) => setNewRow((n) => ({ ...n, dedup_warn_threshold: parseFloat(e.target.value) }))}
                  className="w-full rounded border border-[#D1D5DB] px-2 py-1 text-xs text-[#1B2A4A] focus:outline-none focus:ring-1 focus:ring-[#1B2A4A]"
                />
              </label>
            </div>
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="ghost" onClick={() => setAddingNew(false)} className="h-7 text-xs">
                Cancel
              </Button>
              <Button size="sm" onClick={handleAddNew} disabled={saving === 'new'} className="h-7 text-xs gap-1">
                <Save className="h-3 w-3" />
                {saving === 'new' ? 'Saving…' : 'Save rule'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
