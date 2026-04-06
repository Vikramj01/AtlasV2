/**
 * Planning Mode — Step 6: Consent & Privacy
 *
 * Asks whether consent is configured for this property and links
 * the planning session to an existing consent_config or guides
 * the user to set one up.
 *
 * Three paths:
 *   A. "Already using a CMP / consent configured" → detect existing config or
 *      let user paste the project_id
 *   B. "Set up consent now" → redirect to /consent (opens in same tab)
 *   C. "Skip for now" → proceed with a warning banner
 *
 * The consent_config_id is persisted to the planning session via
 * PATCH /api/planning/sessions/:id so the GTM generator can include
 * Consent Mode v2 tags.
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, ExternalLink, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { InfoTooltip } from '@/components/common/EducationTooltip';
import { Button } from '@/components/ui/button';
import { usePlanningStore } from '@/store/planningStore';
import { planningApi } from '@/lib/api/planningApi';

type ConsentChoice = 'configured' | 'setup_later' | 'not_required' | null;

export function Step6ConsentStep() {
  const navigate = useNavigate();
  const { currentSession, consentConfigId, setConsentConfigId, nextStep, prevStep } = usePlanningStore();

  const [choice, setChoice] = useState<ConsentChoice>(
    consentConfigId ? 'configured' : null
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedConfig, setSavedConfig] = useState<boolean>(consentConfigId !== null);

  // If a consent config was previously linked, mark as "configured"
  useEffect(() => {
    if (consentConfigId) {
      setChoice('configured');
      setSavedConfig(true);
    }
  }, [consentConfigId]);

  async function handleContinue() {
    if (!currentSession) return;
    setIsSaving(true);
    setError(null);

    try {
      if (choice === 'configured' && consentConfigId) {
        await planningApi.updateSession(currentSession.id, { consent_config_id: consentConfigId });
      } else {
        await planningApi.updateSession(currentSession.id, { consent_config_id: null });
        setConsentConfigId(null);
      }

      // Trigger output generation (consent config is now saved, so GTM output will include consent tags)
      await planningApi.generateOutputs(currentSession.id);

      nextStep();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save consent config');
    } finally {
      setIsSaving(false);
    }
  }

  function handleOpenConsent() {
    // Open consent settings in a new tab so the wizard isn't lost
    window.open('/consent', '_blank', 'noopener');
  }

  const canContinue = choice !== null;

  return (
    <div className="mx-auto max-w-2xl px-6 py-10 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100">
          <Shield className="h-5 w-5 text-blue-600" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-foreground">Consent & Privacy</h2>
            <InfoTooltip contentKey="planning.consent_step" />
          </div>
          <p className="text-sm text-muted-foreground">
            Step 6 of 8 — Is consent management configured for this site?
          </p>
        </div>
      </div>

      <p className="text-sm text-muted-foreground leading-relaxed">
        When consent is configured, Atlas includes a <strong>Consent Mode v2 update tag</strong> in
        your generated GTM container — so ad platform tags only fire when visitors have given
        the appropriate consent.
      </p>

      {/* Choice cards */}
      <div className="space-y-3">

        {/* Option A: Already configured */}
        <button
          type="button"
          onClick={() => setChoice('configured')}
          className={`w-full text-left rounded-xl border-2 px-5 py-4 transition-colors ${
            choice === 'configured'
              ? 'border-[#1B2A4A] bg-[#EEF1F7]'
              : 'border-border hover:border-[#1B2A4A]/30 bg-background'
          }`}
        >
          <div className="flex items-start gap-3">
            <div className={`mt-0.5 h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
              choice === 'configured' ? 'border-[#1B2A4A]' : 'border-muted-foreground/30'
            }`}>
              {choice === 'configured' && (
                <div className="h-2 w-2 rounded-full bg-[#1B2A4A]" />
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                Consent is already configured for this site
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                You've set up the Atlas consent banner or integrated a CMP via the Consent Hub.
                Atlas will include a Consent Mode v2 update tag in the generated GTM container.
              </p>
              {choice === 'configured' && (
                <div className="mt-3 flex items-center gap-2">
                  {savedConfig ? (
                    <div className="flex items-center gap-1.5 text-xs text-green-600">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Consent config linked
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenConsent();
                      }}
                      className="flex items-center gap-1 text-xs text-[#1B2A4A] hover:text-[#1B2A4A] underline"
                    >
                      View Consent Hub
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </button>

        {/* Option B: Set up later */}
        <button
          type="button"
          onClick={() => setChoice('setup_later')}
          className={`w-full text-left rounded-xl border-2 px-5 py-4 transition-colors ${
            choice === 'setup_later'
              ? 'border-amber-400 bg-amber-50'
              : 'border-border hover:border-amber-300 bg-background'
          }`}
        >
          <div className="flex items-start gap-3">
            <div className={`mt-0.5 h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
              choice === 'setup_later' ? 'border-amber-500' : 'border-muted-foreground/30'
            }`}>
              {choice === 'setup_later' && (
                <div className="h-2 w-2 rounded-full bg-amber-500" />
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                I'll set up consent later
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                The generated GTM container will include Consent Mode v2 defaults (deny by default)
                but no update tag. Configure the Consent Hub and regenerate when ready.
              </p>
              {choice === 'setup_later' && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleOpenConsent(); }}
                  className="mt-2 flex items-center gap-1 text-xs text-amber-700 hover:text-amber-800 underline"
                >
                  Set up now in Consent Hub
                  <ExternalLink className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        </button>

        {/* Option C: Not required */}
        <button
          type="button"
          onClick={() => setChoice('not_required')}
          className={`w-full text-left rounded-xl border-2 px-5 py-4 transition-colors ${
            choice === 'not_required'
              ? 'border-gray-400 bg-gray-50'
              : 'border-border hover:border-gray-300 bg-background'
          }`}
        >
          <div className="flex items-start gap-3">
            <div className={`mt-0.5 h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
              choice === 'not_required' ? 'border-gray-500' : 'border-muted-foreground/30'
            }`}>
              {choice === 'not_required' && (
                <div className="h-2 w-2 rounded-full bg-gray-500" />
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                Consent management is not required for this jurisdiction
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                For sites that are exempt from GDPR/CCPA (e.g., US-only B2B with no EU traffic).
              </p>
            </div>
          </div>
        </button>

      </div>

      {/* Warning for skip / not required */}
      {(choice === 'setup_later' || choice === 'not_required') && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800 leading-relaxed">
            {choice === 'setup_later'
              ? 'Without consent management, your tracking may not comply with GDPR or CCPA. You can configure this at any time in Settings → Consent Hub.'
              : 'Please confirm your legal team has reviewed that consent collection is not required for your site\'s audience and jurisdiction.'}
          </p>
        </div>
      )}

      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}

      {/* Navigation */}
      <div className="flex justify-between pt-2">
        <Button type="button" variant="outline" onClick={prevStep}>
          Back
        </Button>
        <Button
          type="button"
          onClick={handleContinue}
          disabled={!canContinue || isSaving}
          className="bg-[#1B2A4A] hover:bg-[#1B2A4A] text-white"
        >
          {isSaving ? 'Saving & generating…' : 'Continue to outputs →'}
        </Button>
      </div>

      {/* Consent Hub shortcut */}
      <div className="text-center">
        <button
          type="button"
          onClick={() => navigate('/consent')}
          className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
        >
          Open Consent Hub to configure your banner
        </button>
      </div>
    </div>
  );
}
