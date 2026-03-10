import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useJourneyWizardStore } from '@/store/journeyWizardStore';
import { createJourney, generateSpecs, saveTemplate } from '@/lib/api/journeyApi';
import { auditApi } from '@/lib/api/auditApi';
import { ACTION_TOGGLES, PLATFORM_OPTIONS } from '@/types/journey';

interface Step4Props {
  onBack: () => void;
}

export function Step4Review({ onBack }: Step4Props) {
  const navigate = useNavigate();
  const { businessType, stages, platforms, implementationFormat, reset } = useJourneyWizardStore();

  const [loading, setLoading] = useState<'audit' | 'spec' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateSaved, setTemplateSaved] = useState(false);
  const [showTemplateSave, setShowTemplateSave] = useState(false);

  const activePlatforms = platforms.filter((p) => p.isActive);
  const activeActions = stages.flatMap((s) => s.actions).filter((a) => a !== 'ad_landing');
  const uniqueActions = [...new Set(activeActions)];

  const ruleCount = Math.max(26, uniqueActions.length * activePlatforms.length + 6);

  async function submitJourney(mode: 'audit' | 'spec') {
    if (!businessType) return;
    setLoading(mode);
    setError(null);

    try {
      const payload = {
        name: `${businessType.replace('_', ' ')} Journey`,
        business_type: businessType,
        implementation_format: implementationFormat,
        stages: stages.map((s) => ({
          stage_order: s.order,
          label: s.label,
          page_type: s.pageType,
          sample_url: s.sampleUrl || null,
          actions: s.actions,
        })),
        platforms: platforms.map((p) => ({
          platform: p.platform,
          is_active: p.isActive,
          measurement_id: p.measurementId || null,
        })),
      };

      const result = await createJourney(payload);
      const journeyId = result.journey.id;

      await generateSpecs(journeyId);

      reset();

      if (mode === 'audit') {
        const auditResult = await auditApi.startFromJourney(journeyId);
        navigate(`/audit/${auditResult.audit_id}/progress?journeyId=${journeyId}`);
      } else {
        navigate(`/journey/${journeyId}/spec`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(null);
    }
  }

  async function handleSaveTemplate() {
    if (!businessType || !templateName.trim()) return;
    setSavingTemplate(true);
    try {
      await saveTemplate({
        name: templateName.trim(),
        business_type: businessType,
        template_data: {
          stages: stages.map((s) => ({
            order: s.order,
            label: s.label,
            page_type: s.pageType,
            actions: s.actions,
          })),
        },
      });
      setTemplateSaved(true);
      setShowTemplateSave(false);
      setTemplateName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save template');
    } finally {
      setSavingTemplate(false);
    }
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-center">Here's what Atlas will check</h2>
      <p className="mt-2 text-center text-muted-foreground text-sm">Review your journey and choose how to proceed.</p>

      <Card className="mt-6">
        <CardContent className="p-5 space-y-4">
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Your Funnel</h3>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {stages.map((s, i) => (
                <span key={s.id} className="flex items-center gap-1">
                  <span className="rounded-lg bg-brand-50 border border-brand-200 px-2 py-1 text-xs font-medium text-brand-800">
                    {s.label}
                  </span>
                  {i < stages.length - 1 && <span className="text-muted-foreground">→</span>}
                </span>
              ))}
            </div>
          </section>

          {uniqueActions.length > 0 && (
            <>
              <Separator />
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Key Actions</h3>
                <ul className="mt-2 space-y-1">
                  {uniqueActions.map((actionKey) => {
                    const toggle = ACTION_TOGGLES.find((t) => t.key === actionKey);
                    const stage = stages.find((s) => s.actions.includes(actionKey));
                    return (
                      <li key={actionKey} className="text-sm text-muted-foreground">
                        • {toggle?.label ?? actionKey}{stage ? ` — tracked on ${stage.label}` : ''}
                      </li>
                    );
                  })}
                </ul>
              </section>
            </>
          )}

          <Separator />
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Platforms</h3>
            <p className="mt-2 text-sm">
              {activePlatforms
                .map((p) => PLATFORM_OPTIONS.find((o) => o.value === p.platform)?.label ?? p.platform)
                .join(', ')}
            </p>
          </section>

          <Separator />
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Implementation Format</h3>
            <p className="mt-2 text-sm">
              {implementationFormat === 'gtm'
                ? 'Google Tag Manager (dataLayer)'
                : implementationFormat === 'walkeros'
                ? 'WalkerOS (flow.json)'
                : 'Both — GTM dataLayer + WalkerOS flow.json'}
            </p>
          </section>

          <Separator />
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Atlas Will Check</h3>
            <p className="mt-2 text-sm">
              <span className="font-semibold">{ruleCount} signal rules</span> across{' '}
              <span className="font-semibold">{stages.length} funnel stages</span> for{' '}
              <span className="font-semibold">{activePlatforms.length} platform{activePlatforms.length !== 1 ? 's' : ''}</span>
            </p>
          </section>
        </CardContent>
      </Card>

      {error && (
        <p className="mt-4 rounded-lg bg-destructive/10 px-4 py-2.5 text-sm text-destructive">{error}</p>
      )}

      <div className="mt-6 space-y-3">
        <Button
          type="button"
          onClick={() => submitJourney('audit')}
          disabled={loading !== null}
          className="w-full bg-brand-600 hover:bg-brand-700 py-3"
        >
          {loading === 'audit' ? 'Setting up audit…' : 'Run Audit'}
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={() => submitJourney('spec')}
          disabled={loading !== null}
          className="w-full py-3"
        >
          {loading === 'spec' ? 'Generating spec…' : 'Just Generate the Spec'}
        </Button>

        <Button
          type="button"
          variant="ghost"
          onClick={onBack}
          disabled={loading !== null}
          className="w-full text-muted-foreground"
        >
          Back
        </Button>
      </div>

      <div className="mt-4 border-t pt-4">
        {templateSaved ? (
          <p className="text-center text-sm text-green-600">Template saved — it will appear on the first step next time.</p>
        ) : showTemplateSave ? (
          <div className="flex gap-2">
            <Input
              autoFocus
              type="text"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveTemplate();
                if (e.key === 'Escape') setShowTemplateSave(false);
              }}
              placeholder="Template name…"
            />
            <Button
              type="button"
              onClick={handleSaveTemplate}
              disabled={savingTemplate || !templateName.trim()}
            >
              {savingTemplate ? 'Saving…' : 'Save'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowTemplateSave(false)}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowTemplateSave(true)}
            className="w-full text-center text-xs text-muted-foreground hover:text-brand-600 transition-colors"
          >
            + Save this journey as a reusable template
          </button>
        )}
      </div>
    </div>
  );
}
