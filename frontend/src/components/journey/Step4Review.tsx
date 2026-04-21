import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { useJourneyWizardStore } from '@/store/journeyWizardStore';
import { createJourney, generateSpecs, saveTemplate } from '@/lib/api/journeyApi';
import { auditApi } from '@/lib/api/auditApi';
import { ACTION_TOGGLES, PLATFORM_OPTIONS } from '@/types/journey';

interface Step4Props {
  onBack: () => void;
}

const NAVY = '#1B2A4A';

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
      <h2 className="text-page-title text-center">Here's what Atlas will check</h2>
      <p className="mt-2 text-center text-body text-[#6B7280]">
        Review your journey and choose how to proceed.
      </p>

      {/* ── Summary card ──────────────────────────────────────────────────── */}
      <div className="mt-6 rounded-lg border border-[#E5E7EB] bg-white">

        {/* Funnel flow nodes */}
        <div className="px-5 pt-5 pb-4">
          <h3 className="text-caption-upper mb-3">Your Funnel</h3>
          <div className="flex flex-wrap items-center gap-1.5">
            {stages.map((s, i) => (
              <span key={s.id} className="flex items-center gap-1.5">
                {/* Stage node */}
                <span
                  className="inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-semibold"
                  style={{
                    backgroundColor: '#EEF1F7',
                    borderColor: `${NAVY}30`,
                    color: NAVY,
                  }}
                >
                  {s.label}
                </span>
                {/* Arrow */}
                {i < stages.length - 1 && (
                  <svg width="14" height="10" viewBox="0 0 14 10" fill="none" aria-hidden="true">
                    <path d="M0 5H12M8 1L12 5L8 9" stroke="#D1D5DB" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
            ))}
          </div>
        </div>

        {uniqueActions.length > 0 && (
          <>
            <Separator />
            <div className="px-5 py-4">
              <h3 className="text-caption-upper mb-2">Key Actions</h3>
              <ul className="space-y-1">
                {uniqueActions.map((actionKey) => {
                  const toggle = ACTION_TOGGLES.find((t) => t.key === actionKey);
                  const stage  = stages.find((s) => s.actions.includes(actionKey));
                  return (
                    <li key={actionKey} className="text-sm text-[#6B7280]">
                      · {toggle?.label ?? actionKey}
                      {stage ? <span className="text-[#9CA3AF]"> — {stage.label}</span> : ''}
                    </li>
                  );
                })}
              </ul>
            </div>
          </>
        )}

        <Separator />
        <div className="px-5 py-4">
          <h3 className="text-caption-upper mb-2">Platforms</h3>
          <p className="text-sm text-[#1A1A1A]">
            {activePlatforms
              .map((p) => PLATFORM_OPTIONS.find((o) => o.value === p.platform)?.label ?? p.platform)
              .join(', ')}
          </p>
        </div>

        <Separator />
        <div className="px-5 py-4">
          <h3 className="text-caption-upper mb-2">Implementation Format</h3>
          <p className="text-sm text-[#1A1A1A]">
            Google Tag Manager (dataLayer)
          </p>
        </div>

        <Separator />
        <div className="px-5 py-4">
          <h3 className="text-caption-upper mb-2">Atlas Will Check</h3>
          <p className="text-sm text-[#1A1A1A]">
            <span className="font-semibold">{ruleCount} signal rules</span> across{' '}
            <span className="font-semibold">{stages.length} funnel stages</span> for{' '}
            <span className="font-semibold">
              {activePlatforms.length} platform{activePlatforms.length !== 1 ? 's' : ''}
            </span>
          </p>
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-[#DC2626]/20 bg-[#FEF2F2] px-4 py-2.5 text-sm text-[#DC2626]">
          {error}
        </p>
      )}

      {/* ── Actions ───────────────────────────────────────────────────────── */}
      <div className="mt-6 space-y-3">
        <Button
          type="button"
          onClick={() => submitJourney('audit')}
          disabled={loading !== null}
          className="w-full py-3"
        >
          {loading === 'audit' ? 'Setting up audit…' : 'Run Audit'}
        </Button>

        <Button
          type="button"
          variant="secondary"
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
          className="w-full"
        >
          Back
        </Button>
      </div>

      {/* ── Template save ─────────────────────────────────────────────────── */}
      <div className="mt-4 border-t border-[#E5E7EB] pt-4">
        {templateSaved ? (
          <p className="text-center text-sm text-[#059669]">
            Template saved — it will appear on the first step next time.
          </p>
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
            <Button type="button" onClick={handleSaveTemplate} disabled={savingTemplate || !templateName.trim()}>
              {savingTemplate ? 'Saving…' : 'Save'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setShowTemplateSave(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowTemplateSave(true)}
            className="w-full text-center text-xs text-[#9CA3AF] hover:text-[#1B2A4A] transition-colors"
          >
            + Save this journey as a reusable template
          </button>
        )}
      </div>
    </div>
  );
}
