import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useJourneyWizardStore } from '@/store/journeyWizardStore';
import { createJourney, generateSpecs } from '@/lib/api/journeyApi';
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

  const activePlatforms = platforms.filter((p) => p.isActive);
  const activeActions = stages.flatMap((s) => s.actions).filter((a) => a !== 'ad_landing');
  const uniqueActions = [...new Set(activeActions)];

  // Rough rule count estimate
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

      // Always generate the spec (needed by both audit and spec-only paths)
      await generateSpecs(journeyId);

      reset();

      if (mode === 'audit') {
        // Start the journey-based audit and redirect to the progress screen
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

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 text-center">Here's what Atlas will check</h2>
      <p className="mt-2 text-center text-gray-500 text-sm">Review your journey and choose how to proceed.</p>

      <div className="mt-6 rounded-xl border border-gray-200 bg-white p-5 space-y-5">
        {/* Funnel */}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Your Funnel</h3>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {stages.map((s, i) => (
              <span key={s.id} className="flex items-center gap-1">
                <span className="rounded-lg bg-brand-50 border border-brand-200 px-2 py-1 text-xs font-medium text-brand-800">
                  {s.label}
                </span>
                {i < stages.length - 1 && <span className="text-gray-400">→</span>}
              </span>
            ))}
          </div>
        </section>

        {/* Key actions */}
        {uniqueActions.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Key Actions</h3>
            <ul className="mt-2 space-y-1">
              {uniqueActions.map((actionKey) => {
                const toggle = ACTION_TOGGLES.find((t) => t.key === actionKey);
                const stage = stages.find((s) => s.actions.includes(actionKey));
                return (
                  <li key={actionKey} className="text-sm text-gray-700">
                    • {toggle?.label ?? actionKey}{stage ? ` — tracked on ${stage.label}` : ''}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Platforms */}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Platforms</h3>
          <p className="mt-2 text-sm text-gray-700">
            {activePlatforms
              .map((p) => PLATFORM_OPTIONS.find((o) => o.value === p.platform)?.label ?? p.platform)
              .join(', ')}
          </p>
        </section>

        {/* Implementation format */}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Implementation Format</h3>
          <p className="mt-2 text-sm text-gray-700">
            {implementationFormat === 'gtm'
              ? 'Google Tag Manager (dataLayer)'
              : implementationFormat === 'walkeros'
              ? 'WalkerOS (flow.json)'
              : 'Both — GTM dataLayer + WalkerOS flow.json'}
          </p>
        </section>

        {/* Rule count */}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Atlas Will Check</h3>
          <p className="mt-2 text-sm text-gray-700">
            <span className="font-semibold">{ruleCount} signal rules</span> across{' '}
            <span className="font-semibold">{stages.length} funnel stages</span> for{' '}
            <span className="font-semibold">{activePlatforms.length} platform{activePlatforms.length !== 1 ? 's' : ''}</span>
          </p>
        </section>
      </div>

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p>
      )}

      <div className="mt-6 space-y-3">
        <button
          type="button"
          onClick={() => submitJourney('audit')}
          disabled={loading !== null}
          className="w-full rounded-lg bg-brand-600 px-4 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
        >
          {loading === 'audit' ? 'Setting up audit…' : 'Run Audit'}
        </button>

        <button
          type="button"
          onClick={() => submitJourney('spec')}
          disabled={loading !== null}
          className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          {loading === 'spec' ? 'Generating spec…' : 'Just Generate the Spec'}
        </button>

        <button
          type="button"
          onClick={onBack}
          disabled={loading !== null}
          className="w-full text-sm text-gray-500 hover:text-gray-700"
        >
          Back
        </button>
      </div>
    </div>
  );
}
