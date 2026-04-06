/**
 * CMPIntegration — CMP provider configuration UI
 *
 * Allows users to:
 *   1. Select a CMP provider (OneTrust, Cookiebot, Usercentrics)
 *   2. Enter provider credentials (domain script / group ID / settings ID)
 *   3. Configure category mapping (CMP category ID → Atlas category)
 *   4. Test the connection and view detection status
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { CMPConfig, ConsentCategory, ConsentMode } from '@/types/consent';

// ── Props ─────────────────────────────────────────────────────────────────────

interface CMPIntegrationProps {
  projectId: string;
  currentMode: ConsentMode;
  currentCmpConfig: CMPConfig | null;
  onSave: (mode: ConsentMode, config: CMPConfig) => Promise<void>;
  saving?: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ATLAS_CATEGORIES: ConsentCategory[] = ['analytics', 'marketing', 'personalisation', 'functional'];

const ATLAS_CATEGORY_LABELS: Record<ConsentCategory, string> = {
  analytics: 'Analytics',
  marketing: 'Marketing',
  personalisation: 'Personalisation',
  functional: 'Functional',
};

// Default category mappings per CMP
const DEFAULT_MAPPINGS: Record<Exclude<ConsentMode, 'builtin'>, Array<{ cmpKey: string; label: string; atlasCategory: ConsentCategory }>> = {
  onetrust: [
    { cmpKey: 'C0002', label: 'C0002 — Performance', atlasCategory: 'analytics' },
    { cmpKey: 'C0003', label: 'C0003 — Functional', atlasCategory: 'personalisation' },
    { cmpKey: 'C0004', label: 'C0004 — Targeting', atlasCategory: 'marketing' },
  ],
  cookiebot: [
    { cmpKey: 'statistics', label: 'Statistics', atlasCategory: 'analytics' },
    { cmpKey: 'preferences', label: 'Preferences', atlasCategory: 'personalisation' },
    { cmpKey: 'marketing', label: 'Marketing', atlasCategory: 'marketing' },
    { cmpKey: 'necessary', label: 'Necessary', atlasCategory: 'functional' },
  ],
  usercentrics: [],
};

const PROVIDER_LABELS: Record<Exclude<ConsentMode, 'builtin'>, string> = {
  onetrust: 'OneTrust',
  cookiebot: 'Cookiebot',
  usercentrics: 'Usercentrics',
};

const CREDENTIAL_LABELS: Record<Exclude<ConsentMode, 'builtin'>, { label: string; placeholder: string; hint: string }> = {
  onetrust: {
    label: 'Domain Script (UUID)',
    placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    hint: 'Found in OneTrust dashboard under Scripts & Templates.',
  },
  cookiebot: {
    label: 'Domain Group ID (CBID)',
    placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    hint: 'Found in your Cookiebot account under Domain Groups.',
  },
  usercentrics: {
    label: 'Settings ID',
    placeholder: 'XXXXXXXXXXXXX',
    hint: 'Found in the Usercentrics Admin Interface under Configuration.',
  },
};

// Window type for CMP detection
interface CMPWindow {
  OneTrust?: unknown;
  Cookiebot?: unknown;
  UC_UI?: unknown;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function detectCMPOnPage(mode: Exclude<ConsentMode, 'builtin'>): boolean {
  try {
    const w = window as CMPWindow;
    switch (mode) {
      case 'onetrust':
        return Boolean(w.OneTrust);
      case 'cookiebot':
        return Boolean(w.Cookiebot);
      case 'usercentrics':
        return Boolean(w.UC_UI);
    }
  } catch {
    return false;
  }
}

function buildDefaultMapping(mode: Exclude<ConsentMode, 'builtin'>): Record<string, ConsentCategory> {
  const entries = DEFAULT_MAPPINGS[mode];
  return Object.fromEntries(entries.map((e) => [e.cmpKey, e.atlasCategory]));
}

type MappingRow = { cmpKey: string; atlasCategory: ConsentCategory };

function mappingToRows(mapping: Record<string, ConsentCategory>): MappingRow[] {
  return Object.entries(mapping).map(([cmpKey, atlasCategory]) => ({ cmpKey, atlasCategory }));
}

function rowsToMapping(rows: MappingRow[]): Record<string, ConsentCategory> {
  const result: Record<string, ConsentCategory> = {};
  for (const row of rows) {
    if (row.cmpKey.trim()) {
      result[row.cmpKey.trim()] = row.atlasCategory;
    }
  }
  return result;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CMPIntegration({
  currentMode,
  currentCmpConfig,
  onSave,
  saving = false,
}: CMPIntegrationProps) {
  const isCMPMode = currentMode !== 'builtin';
  const activeCMPMode = isCMPMode ? (currentMode as Exclude<ConsentMode, 'builtin'>) : 'onetrust';

  const [selectedProvider, setSelectedProvider] = useState<Exclude<ConsentMode, 'builtin'>>(activeCMPMode);
  const [apiKey, setApiKey] = useState<string>(currentCmpConfig?.api_key ?? '');
  const [mappingRows, setMappingRows] = useState<MappingRow[]>(() => {
    if (currentCmpConfig?.category_mapping && Object.keys(currentCmpConfig.category_mapping).length > 0) {
      return mappingToRows(currentCmpConfig.category_mapping);
    }
    return mappingToRows(buildDefaultMapping(activeCMPMode));
  });

  const [detected, setDetected] = useState<boolean | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Reset form when provider changes
  useEffect(() => {
    setApiKey('');
    setMappingRows(mappingToRows(buildDefaultMapping(selectedProvider)));
    setDetected(null);
    setSaveError(null);
  }, [selectedProvider]);

  function handleDetect() {
    const isDetected = detectCMPOnPage(selectedProvider);
    setDetected(isDetected);
  }

  async function handleSave() {
    setSaveError(null);
    setSaveSuccess(false);

    if (!apiKey.trim()) {
      setSaveError('Please enter the required credential.');
      return;
    }

    const config: CMPConfig = {
      api_key: apiKey.trim(),
      category_mapping: rowsToMapping(mappingRows),
    };

    try {
      await onSave(selectedProvider, config);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      // Re-check detection after save
      setDetected(detectCMPOnPage(selectedProvider));
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save CMP configuration.');
    }
  }

  function handleAddMappingRow() {
    setMappingRows((prev: MappingRow[]) => [...prev, { cmpKey: '', atlasCategory: 'analytics' }]);
  }

  function handleRemoveMappingRow(index: number) {
    setMappingRows((prev: MappingRow[]) => prev.filter((_: MappingRow, i: number) => i !== index));
  }

  function handleMappingKeyChange(index: number, value: string) {
    setMappingRows((prev: MappingRow[]) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], cmpKey: value };
      return updated;
    });
  }

  function handleMappingCategoryChange(index: number, value: ConsentCategory) {
    setMappingRows((prev: MappingRow[]) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], atlasCategory: value };
      return updated;
    });
  }

  const credentialInfo: { label: string; placeholder: string; hint: string } = CREDENTIAL_LABELS[selectedProvider];

  return (
    <div className="space-y-6">
      {/* Notice callout */}
      <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
        <span className="mt-0.5 shrink-0 text-base">ℹ</span>
        <p>
          When a CMP is active, Atlas consent records are driven by the CMP.{' '}
          <strong>The built-in banner is disabled.</strong>
        </p>
      </div>

      {/* Provider selector */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">CMP Provider</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3">
            {(Object.keys(PROVIDER_LABELS) as Array<Exclude<ConsentMode, 'builtin'>>).map((provider) => (
              <button
                key={provider}
                type="button"
                onClick={() => setSelectedProvider(provider)}
                className={`flex flex-col items-center justify-center rounded-lg border-2 p-4 text-sm font-medium transition-colors ${
                  selectedProvider === provider
                    ? 'border-[#1B2A4A] bg-[#EEF1F7] text-[#1B2A4A]'
                    : 'border-border hover:border-muted-foreground/50 text-muted-foreground hover:text-foreground'
                }`}
              >
                <span className="text-lg mb-1">
                  {provider === 'onetrust' ? '🔒' : provider === 'cookiebot' ? '🍪' : '⚙️'}
                </span>
                {PROVIDER_LABELS[provider]}
                {currentMode === provider && (
                  <Badge variant="secondary" className="mt-2 text-xs">Active</Badge>
                )}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Credentials */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Credentials</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="cmp-api-key">{credentialInfo.label}</Label>
            <Input
              id="cmp-api-key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={credentialInfo.placeholder}
              className="mt-1 font-mono text-sm"
            />
            <p className="mt-1 text-xs text-muted-foreground">{credentialInfo.hint}</p>
          </div>
        </CardContent>
      </Card>

      {/* Category mapping */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            Category Mapping
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddMappingRow}
            >
              + Add row
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-muted-foreground">
            Map each {PROVIDER_LABELS[selectedProvider]} category ID to an Atlas consent category.
            {selectedProvider === 'usercentrics' && ' Enter service templateId or service name as the key.'}
          </p>

          {mappingRows.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No mappings configured. Click "+ Add row" to add one.
            </p>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs font-medium text-muted-foreground px-1">
                <span>{PROVIDER_LABELS[selectedProvider]} key</span>
                <span>Atlas category</span>
                <span></span>
              </div>
              {mappingRows.map((row, index) => (
                <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                  <Input
                    value={row.cmpKey}
                    onChange={(e) => handleMappingKeyChange(index, e.target.value)}
                    placeholder={selectedProvider === 'onetrust' ? 'e.g. C0002' : selectedProvider === 'cookiebot' ? 'e.g. statistics' : 'templateId or name'}
                    className="font-mono text-xs h-8"
                  />
                  <Select
                    value={row.atlasCategory}
                    onValueChange={(val) => handleMappingCategoryChange(index, val as ConsentCategory)}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ATLAS_CATEGORIES.map((cat) => (
                        <SelectItem key={cat} value={cat} className="text-xs">
                          {ATLAS_CATEGORY_LABELS[cat]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleRemoveMappingRow(index)}
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                    aria-label="Remove row"
                  >
                    ×
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detection status + save */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connection Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" size="sm" onClick={handleDetect}>
              Check page detection
            </Button>
            {detected === null ? (
              <span className="text-xs text-muted-foreground">Not checked yet</span>
            ) : detected ? (
              <Badge className="bg-green-100 text-green-800 border-green-200">
                Connected — {PROVIDER_LABELS[selectedProvider]} detected on page
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-muted-foreground">
                Not detected on page
              </Badge>
            )}
          </div>
          {detected === false && (
            <p className="text-xs text-muted-foreground">
              {PROVIDER_LABELS[selectedProvider]} was not found on the current page. Make sure
              the {PROVIDER_LABELS[selectedProvider]} script is installed on your site before
              activating this integration.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Errors and save button */}
      {saveError && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">
          {saveError}
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : `Save ${PROVIDER_LABELS[selectedProvider]} integration`}
        </Button>
        {saveSuccess && (
          <span className="text-sm text-green-600">Saved!</span>
        )}
      </div>
    </div>
  );
}
