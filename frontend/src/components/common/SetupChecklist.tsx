/**
 * SetupChecklist — onboarding progress widget for the HomePage.
 *
 * Queries /api/setup-checklist and renders a 6-step vertical stepper.
 * Each step links to the relevant feature. Collapses when all 6 are complete.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Circle, ChevronRight } from 'lucide-react';
import { checklistApi } from '@/lib/api/checklistApi';
import type { SetupChecklistResponse } from '@/lib/api/checklistApi';

interface StepDef {
  key: keyof SetupChecklistResponse['steps'];
  label: string;
  description: string;
  href: string;
}

const STEPS: StepDef[] = [
  {
    key: 'site_scanned',
    label: 'Scan your site',
    description: 'Use AI to discover what should be tracked on your website.',
    href: '/planning/new',
  },
  {
    key: 'consent_configured',
    label: 'Set up consent',
    description: 'Configure your consent banner to comply with GDPR/CCPA.',
    href: '/consent',
  },
  {
    key: 'tracking_generated',
    label: 'Generate tracking plan',
    description: 'Export a GTM container, dataLayer spec, and implementation guide.',
    href: '/planning',
  },
  {
    key: 'shared_with_developer',
    label: 'Share with your developer',
    description: 'Send a share link so your dev can implement the tracking plan.',
    href: '/planning',
  },
  {
    key: 'capi_connected',
    label: 'Connect ad platforms',
    description: 'Set up server-side conversion API for Meta, Google, and more.',
    href: '/integrations/capi',
  },
  {
    key: 'audit_passed',
    label: 'Verify implementation',
    description: 'Run an audit to confirm your tracking is firing correctly.',
    href: '/journey/new',
  },
  {
    key: 'channel_tracking_enabled',
    label: 'Enable channel tracking',
    description: 'Send session data to Atlas to compare signal quality across acquisition channels.',
    href: '/channels',
  },
];

const READINESS_LABEL: Record<SetupChecklistResponse['readiness_level'], string> = {
  getting_started: 'Getting started',
  building:        'Building',
  strong:          'Strong',
  best_in_class:   'Best in class',
};

const READINESS_COLOR: Record<SetupChecklistResponse['readiness_level'], string> = {
  getting_started: 'bg-gray-100 text-gray-600',
  building:        'bg-amber-100 text-amber-700',
  strong:          'bg-blue-100 text-blue-700',
  best_in_class:   'bg-green-100 text-green-700',
};

export function SetupChecklist() {
  const navigate = useNavigate();
  const [data, setData] = useState<SetupChecklistResponse | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    checklistApi.getChecklist()
      .then((result) => {
        setData(result);
        // Auto-collapse if all steps complete
        if (result.overall_progress_pct === 100) setCollapsed(true);
      })
      .catch(() => {
        // Silently fail — checklist is a nice-to-have, not blocking
      });
  }, []);

  if (!data) return null;

  // Find the first incomplete step (recommended next action)
  const nextStepKey = STEPS.find((s) => !data.steps[s.key].complete)?.key ?? null;

  if (collapsed) {
    return (
      <div className="rounded-xl border bg-green-50 border-green-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <span className="text-sm font-medium text-green-800">Setup complete — you're all set!</span>
        </div>
        <button
          onClick={() => setCollapsed(false)}
          className="text-xs text-green-600 hover:text-green-700"
        >
          Show checklist
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b">
        <div className="flex items-center gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Setup checklist</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Complete these steps to get the most out of Atlas
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${READINESS_COLOR[data.readiness_level]}`}>
            {READINESS_LABEL[data.readiness_level]}
          </span>
          <span className="text-xs font-medium text-muted-foreground tabular-nums">
            {data.overall_progress_pct}%
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-muted">
        <div
          className="h-full bg-brand-500 transition-all duration-500"
          style={{ width: `${data.overall_progress_pct}%` }}
        />
      </div>

      {/* Steps */}
      <ul className="divide-y">
        {STEPS.map((stepDef, idx) => {
          const step = data.steps[stepDef.key];
          const isComplete = step.complete;
          const isNext = stepDef.key === nextStepKey;

          return (
            <li key={stepDef.key}>
              <button
                type="button"
                onClick={() => navigate(stepDef.href)}
                className="w-full flex items-center gap-4 px-5 py-3.5 text-left hover:bg-muted/40 transition-colors group"
              >
                {/* Icon */}
                <div className="shrink-0">
                  {isComplete ? (
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  ) : isNext ? (
                    <div className="h-5 w-5 rounded-full border-2 border-brand-500 flex items-center justify-center">
                      <span className="text-[10px] font-bold text-brand-600">{idx + 1}</span>
                    </div>
                  ) : (
                    <Circle className="h-5 w-5 text-muted-foreground/30" />
                  )}
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${isComplete ? 'text-muted-foreground line-through' : isNext ? 'text-foreground' : 'text-muted-foreground'}`}>
                    {stepDef.label}
                  </p>
                  {!isComplete && (
                    <p className="text-xs text-muted-foreground/70 mt-0.5 leading-relaxed">
                      {stepDef.description}
                    </p>
                  )}
                </div>

                {/* Arrow for next recommended step */}
                {isNext && (
                  <ChevronRight className="h-4 w-4 text-brand-500 shrink-0 group-hover:translate-x-0.5 transition-transform" />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
