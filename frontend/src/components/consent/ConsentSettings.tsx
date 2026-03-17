/**
 * ConsentSettings — Main consent configuration UI
 *
 * Three tabs:
 *   Settings  — mode, regulation, GCM toggle, category defaults
 *   Banner    — colours, copy, position, TTL + snippet preview
 *   Analytics — opt-in rates, by-country, by-day charts (Sprint 4)
 *
 * Used by: ConsentPage (/consent)
 */

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { consentApi } from '@/lib/api/consentApi';
import { useConsentStore } from '@/store/consentStore';
import { generateBannerSnippet } from '@/lib/consent/banner-generator';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import type {
  ConsentConfig,
  ConsentMode,
  ConsentRegulation,
  BannerConfig,
  BannerPosition,
  ConsentCategoryConfig,
} from '@/types/consent';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_BANNER: BannerConfig = {
  position: 'bottom_bar',
  colors: {
    background: '#1e1e2e',
    button_primary: '#6c63ff',
    button_secondary: '#4a4a5a',
    text: '#ffffff',
  },
  copy: {
    heading: 'We use cookies',
    body: 'We use cookies to improve your experience, measure performance, and serve personalised ads.',
    accept_button: 'Accept all',
    reject_button: 'Reject non-essential',
    manage_link: 'Manage preferences',
  },
  logo_url: null,
  ttl_days: 180,
};

// ── Component ─────────────────────────────────────────────────────────────────

export function ConsentSettings() {
  const {
    config, configLoading, configError,
    activeTab, setActiveTab,
    setConfig, setConfigLoading, setConfigError,
  } = useConsentStore();

  const [orgId, setOrgId] = useState<string>('');

  // Form state mirrors config fields
  const [mode, setMode] = useState<ConsentMode>('builtin');
  const [regulation, setRegulation] = useState<ConsentRegulation>('gdpr');
  const [gcmEnabled, setGcmEnabled] = useState(true);
  const [banner, setBanner] = useState<BannerConfig>(DEFAULT_BANNER);
  const [categories, setCategories] = useState<ConsentCategoryConfig[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [snippetCopied, setSnippetCopied] = useState(false);
  const [resolvedProjectId, setResolvedProjectId] = useState<string>('');

  // ── Load user + config ──────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      setConfigLoading(true);
      setConfigError(null);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { setConfigLoading(false); return; }

      const uid = session.user.id;
      setOrgId(uid);
      setResolvedProjectId(uid); // MVP: project_id === user_id

      try {
        const cfg = await consentApi.getConfig(uid);
        applyConfig(cfg);
        setConfig(cfg);
      } catch (err) {
        // 404 means not configured yet — that's fine
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('404') && !msg.includes('CONFIG_NOT_FOUND')) {
          setConfigError(msg);
        }
        // Apply defaults so the form is usable
        setCategories(getDefaultCategories());
      } finally {
        setConfigLoading(false);
      }
    })();
  }, [setConfig, setConfigLoading, setConfigError]);

  function applyConfig(cfg: ConsentConfig) {
    setMode(cfg.mode);
    setRegulation(cfg.regulation);
    setGcmEnabled(cfg.gcm_enabled);
    setBanner(cfg.banner_config ?? DEFAULT_BANNER);
    setCategories(cfg.categories);
  }

  // ── Save ────────────────────────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true);
    setSaveSuccess(false);
    setConfigError(null);

    try {
      const updated = await consentApi.saveConfig(resolvedProjectId, orgId, {
        mode,
        regulation,
        gcm_enabled: gcmEnabled,
        banner_config: banner,
        categories,
      });
      applyConfig(updated);
      setConfig(updated);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  // ── Copy snippet ────────────────────────────────────────────────────────────

  function handleCopySnippet() {
    if (!config && !resolvedProjectId) return;
    const draftConfig: ConsentConfig = config ?? buildDraftConfig();
    const { minified } = generateBannerSnippet(draftConfig, API_BASE);
    const html = `<!-- Atlas Consent Banner -->\n<script>\n${minified}\n</script>`;
    navigator.clipboard.writeText(html).then(() => {
      setSnippetCopied(true);
      setTimeout(() => setSnippetCopied(false), 2500);
    });
  }

  function buildDraftConfig(): ConsentConfig {
    return {
      id: '',
      project_id: resolvedProjectId,
      organization_id: orgId,
      mode,
      regulation,
      categories,
      banner_config: banner,
      cmp_config: null,
      gcm_enabled: gcmEnabled,
      gcm_mapping: {
        analytics:       ['analytics_storage', 'functionality_storage'],
        marketing:       ['ad_storage', 'ad_user_data', 'ad_personalization'],
        personalisation: ['personalization_storage'],
        functional:      ['functionality_storage'],
      },
      created_at: '',
      updated_at: '',
    };
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (configLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
        Loading consent configuration…
      </div>
    );
  }

  const snippet = resolvedProjectId
    ? generateBannerSnippet(config ?? buildDraftConfig(), API_BASE).minified
    : '';

  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div className="flex gap-1 border-b">
        {(['settings', 'banner', 'analytics'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize ${
              activeTab === tab
                ? 'border-brand-600 text-brand-600'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {configError && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">
          {configError}
        </div>
      )}

      {/* ── Settings tab ───────────────────────────────────────────────────── */}
      {activeTab === 'settings' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Consent Mode</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Source</label>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as ConsentMode)}
                  className="w-full border rounded px-3 py-2 text-sm bg-background"
                >
                  <option value="builtin">Built-in (Atlas banner)</option>
                  <option value="onetrust">OneTrust</option>
                  <option value="cookiebot">Cookiebot</option>
                  <option value="usercentrics">Usercentrics</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Regulation</label>
                <select
                  value={regulation}
                  onChange={(e) => setRegulation(e.target.value as ConsentRegulation)}
                  className="w-full border rounded px-3 py-2 text-sm bg-background"
                >
                  <option value="gdpr">GDPR (EU)</option>
                  <option value="ccpa">CCPA (California)</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              <div className="flex items-center gap-3">
                <input
                  id="gcm-toggle"
                  type="checkbox"
                  checked={gcmEnabled}
                  onChange={(e) => setGcmEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <label htmlFor="gcm-toggle" className="text-sm font-medium">
                  Enable Google Consent Mode v2
                </label>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Consent Categories</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {categories.map((cat, idx) => (
                <div key={cat.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <p className="text-sm font-medium">{cat.name}</p>
                    <p className="text-xs text-muted-foreground">{cat.description}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {cat.required ? (
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">Required</span>
                    ) : (
                      <select
                        value={cat.default_state}
                        onChange={(e) => {
                          const updated = [...categories];
                          updated[idx] = { ...cat, default_state: e.target.value as ConsentCategoryConfig['default_state'] };
                          setCategories(updated);
                        }}
                        className="text-xs border rounded px-2 py-1 bg-background"
                      >
                        <option value="granted">Default: granted</option>
                        <option value="denied">Default: denied</option>
                        <option value="pending">Default: pending</option>
                      </select>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="flex items-center gap-3">
            <Button onClick={handleSave} disabled={saving || !resolvedProjectId}>
              {saving ? 'Saving…' : 'Save settings'}
            </Button>
            {saveSuccess && <span className="text-sm text-green-600">Saved!</span>}
          </div>
        </div>
      )}

      {/* ── Banner tab ─────────────────────────────────────────────────────── */}
      {activeTab === 'banner' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Banner Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Position</label>
                <select
                  value={banner.position}
                  onChange={(e) => setBanner({ ...banner, position: e.target.value as BannerPosition })}
                  className="w-full border rounded px-3 py-2 text-sm bg-background"
                >
                  <option value="bottom_bar">Bottom bar</option>
                  <option value="modal">Centred modal</option>
                  <option value="corner">Corner widget</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Consent duration (days)</label>
                <input
                  type="number"
                  min={7}
                  max={365}
                  value={banner.ttl_days}
                  onChange={(e) => setBanner({ ...banner, ttl_days: Number(e.target.value) })}
                  className="w-full border rounded px-3 py-2 text-sm bg-background"
                />
              </div>

              <Separator />
              <p className="text-sm font-medium">Copy</p>

              {(
                [
                  ['heading', 'Heading'],
                  ['body', 'Body text'],
                  ['accept_button', 'Accept button'],
                  ['reject_button', 'Reject button'],
                  ['manage_link', 'Manage link'],
                ] as [keyof typeof banner.copy, string][]
              ).map(([field, label]) => (
                <div key={field}>
                  <label className="block text-xs text-muted-foreground mb-1">{label}</label>
                  <input
                    type="text"
                    value={banner.copy[field]}
                    onChange={(e) =>
                      setBanner({ ...banner, copy: { ...banner.copy, [field]: e.target.value } })
                    }
                    className="w-full border rounded px-3 py-2 text-sm bg-background"
                  />
                </div>
              ))}

              <Separator />
              <p className="text-sm font-medium">Colours</p>

              {(
                [
                  ['background', 'Background'],
                  ['button_primary', 'Primary button'],
                  ['button_secondary', 'Secondary button'],
                  ['text', 'Text'],
                ] as [keyof typeof banner.colors, string][]
              ).map(([field, label]) => (
                <div key={field} className="flex items-center gap-3">
                  <input
                    type="color"
                    value={banner.colors[field]}
                    onChange={(e) =>
                      setBanner({ ...banner, colors: { ...banner.colors, [field]: e.target.value } })
                    }
                    className="h-8 w-8 rounded border cursor-pointer"
                  />
                  <span className="text-sm">{label}</span>
                  <code className="text-xs text-muted-foreground">{banner.colors[field]}</code>
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="flex items-center gap-3">
            <Button onClick={handleSave} disabled={saving || !resolvedProjectId}>
              {saving ? 'Saving…' : 'Save banner settings'}
            </Button>
            {saveSuccess && <span className="text-sm text-green-600">Saved!</span>}
          </div>

          {/* Snippet preview */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                Installation snippet
                <Button variant="outline" size="sm" onClick={handleCopySnippet}>
                  {snippetCopied ? 'Copied!' : 'Copy snippet'}
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground mb-3">
                Paste this inside your &lt;head&gt; tag, <strong>before</strong> any GTM or GA4 snippets.
              </p>
              <pre className="bg-muted rounded p-4 text-xs overflow-x-auto max-h-64 select-all">
                {`<!-- Atlas Consent Banner -->\n<script>\n${snippet}\n</script>`}
              </pre>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Analytics tab (Sprint 4 placeholder) ─────────────────────────── */}
      {activeTab === 'analytics' && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <p className="text-muted-foreground text-sm">
              Consent analytics will be available in Sprint 4.
            </p>
            <p className="text-xs text-muted-foreground">
              Once live, you'll see opt-in rates by category, country, and day.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getDefaultCategories(): ConsentCategoryConfig[] {
  return [
    { id: 'functional', name: 'Functional', description: 'Essential cookies required for the site to work correctly.', required: true, default_state: 'granted' },
    { id: 'analytics', name: 'Analytics', description: 'Cookies that help us understand how visitors interact with the site.', required: false, default_state: 'pending' },
    { id: 'marketing', name: 'Marketing', description: 'Cookies used to deliver personalised ads and measure campaign performance.', required: false, default_state: 'pending' },
    { id: 'personalisation', name: 'Personalisation', description: 'Cookies that remember your preferences to personalise your experience.', required: false, default_state: 'pending' },
  ];
}
