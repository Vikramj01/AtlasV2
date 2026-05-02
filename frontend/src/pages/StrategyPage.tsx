import { useState } from 'react';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { SECTION_LABELS } from '@/lib/ui-copy';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Step1Define } from '@/components/strategy/Step1Define';
import { Step2Verdict } from '@/components/strategy/Step2Verdict';
import { ObjectivesList } from '@/components/strategy/ObjectivesList';
import { BriefLocked } from '@/components/strategy/BriefLocked';
import { useStrategyStore } from '@/store/strategyStore';
import type { BriefMode } from '@/types/strategy';

type View =
  | { name: 'landing' }
  | { name: 'define'; briefId: string; mode: BriefMode; objectiveId: string | null; from: 'landing' | 'objectives' }
  | { name: 'verdict'; briefId: string; mode: BriefMode; objectiveId: string }
  | { name: 'objectives'; briefId: string }
  | { name: 'locked' };

export function StrategyPage() {
  const { createBrief, fetchBrief } = useStrategyStore();
  const [view, setView] = useState<View>({ name: 'landing' });
  const [modeLoading, setModeLoading] = useState(false);
  const [modeError, setModeError] = useState<string | null>(null);

  async function handleModeSelect(mode: BriefMode) {
    setModeLoading(true);
    setModeError(null);
    try {
      const brief = await createBrief({ mode });
      await fetchBrief(brief.id);
      setView({ name: 'define', briefId: brief.id, mode, objectiveId: null, from: 'landing' });
    } catch (err) {
      setModeError(err instanceof Error ? err.message : 'Failed to create brief.');
    } finally {
      setModeLoading(false);
    }
  }

  function handleEvaluated(objectiveId: string) {
    if (view.name !== 'define') return;
    setView({ name: 'verdict', briefId: view.briefId, mode: view.mode, objectiveId });
  }

  function handleLocked() {
    if (view.name !== 'verdict') return;
    if (view.mode === 'single') {
      setView({ name: 'locked' });
    } else {
      setView({ name: 'objectives', briefId: view.briefId });
    }
  }

  function handleEditInputs() {
    if (view.name !== 'verdict') return;
    setView({
      name: 'define',
      briefId: view.briefId,
      mode: view.mode,
      objectiveId: view.objectiveId,
      from: view.mode === 'multi' ? 'objectives' : 'landing',
    });
  }

  function handleAddObjective() {
    if (view.name !== 'objectives') return;
    setView({ name: 'define', briefId: view.briefId, mode: 'multi', objectiveId: null, from: 'objectives' });
  }

  function handleSelectObjective(objectiveId: string) {
    if (view.name !== 'objectives') return;
    setView({ name: 'verdict', briefId: view.briefId, mode: 'multi', objectiveId });
  }

  function handleBriefLocked() {
    setView({ name: 'locked' });
  }

  function handleBackFromDefine() {
    if (view.name !== 'define') return;
    if (view.from === 'objectives') {
      setView({ name: 'objectives', briefId: view.briefId });
    } else {
      setView({ name: 'landing' });
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      {view.name === 'landing' && (
        <Landing onSelectMode={handleModeSelect} loading={modeLoading} error={modeError} />
      )}
      {view.name === 'define' && (
        <Step1Define
          briefId={view.briefId}
          mode={view.mode}
          objectiveId={view.objectiveId}
          onEvaluated={handleEvaluated}
          onBack={handleBackFromDefine}
        />
      )}
      {view.name === 'verdict' && (
        <Step2Verdict
          objectiveId={view.objectiveId}
          mode={view.mode}
          onLocked={handleLocked}
          onEditInputs={handleEditInputs}
        />
      )}
      {view.name === 'objectives' && (
        <ObjectivesList
          briefId={view.briefId}
          onAddObjective={handleAddObjective}
          onSelectObjective={handleSelectObjective}
          onBriefLocked={handleBriefLocked}
        />
      )}
      {view.name === 'locked' && <BriefLocked onNewBrief={() => setView({ name: 'landing' })} />}
    </div>
  );
}

// ── Landing ───────────────────────────────────────────────────────────────────

interface LandingProps {
  onSelectMode: (mode: BriefMode) => void;
  loading: boolean;
  error: string | null;
}

function Landing({ onSelectMode, loading, error }: LandingProps) {
  return (
    <div className="space-y-10">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          {SECTION_LABELS.conversionStrategyGate.primary}
          <span className="text-muted-foreground text-base font-normal ml-3">{SECTION_LABELS.conversionStrategyGate.technical}</span>
        </h1>
        <p className="mt-3 text-muted-foreground max-w-lg">
          Your ad platforms optimise toward whatever conversion event you send them. If that event
          isn't tied to real business success, Meta and Google will find you more of the wrong
          customers — faster. A few minutes here protects every ad dollar you spend after this.
        </p>
      </div>

      {/* What you get — informational, not interactive */}
      <div className="rounded-xl border border-border bg-muted/20 px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">What you get</p>
        <div className="space-y-3">
          {[
            {
              label: 'A verdict for each conversion goal',
              description: 'CONFIRM the event you already use, AUGMENT it with a proxy, or REPLACE it with something better aligned to real business outcomes.',
            },
            {
              label: 'A shareable strategy brief',
              description: 'A signed-off PDF summarising every objective and its recommended event — ready to hand to your team or a client.',
            },
            {
              label: 'The foundation every other Atlas feature builds on',
              description: 'Site scans, tracking plans, and CAPI configuration all use this strategy as their source of truth.',
            },
          ].map((item) => (
            <div key={item.label} className="flex gap-3">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary/60" />
              <div>
                <p className="text-sm font-medium leading-snug">{item.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Mode cards */}
      <div>
        <p className="mb-3 text-sm font-medium text-muted-foreground">
          Does this business have one objective or multiple?
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <ModeCard
            title="One objective"
            description="Most small businesses. One product, one funnel, one conversion to optimise."
            disabled={loading}
            onClick={() => onSelectMode('single')}
          />
          <ModeCard
            title="Multiple objectives"
            description="Multiple distinct outcomes — e.g. D2C sales plus wholesale leads, or acquisition plus retention."
            disabled={loading}
            onClick={() => onSelectMode('multi')}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">You can change this later.</p>
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Creating brief…
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

interface ModeCardProps {
  title: string;
  description: string;
  disabled: boolean;
  onClick: () => void;
}

function ModeCard({ title, description, disabled, onClick }: ModeCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-start rounded-xl border border-border bg-card p-6 text-left shadow-sm transition-all hover:border-primary/50 hover:shadow-md disabled:pointer-events-none disabled:opacity-50"
    >
      <p className="text-base font-semibold">{title}</p>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      <span className="mt-4 text-sm font-medium text-primary">Get started →</span>
    </button>
  );
}
