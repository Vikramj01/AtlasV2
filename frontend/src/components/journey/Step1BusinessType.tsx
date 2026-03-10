import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { BusinessType } from '@/types/journey';
import { BUSINESS_TYPE_OPTIONS } from '@/types/journey';
import { useJourneyWizardStore } from '@/store/journeyWizardStore';
import { listTemplates, deleteUserTemplate } from '@/lib/api/journeyApi';
import type { SavedTemplate } from '@/lib/api/journeyApi';

interface Step1Props {
  onNext: () => void;
}

const BUSINESS_TYPE_LABELS: Record<string, string> = {
  ecommerce: 'E-commerce',
  saas: 'SaaS',
  lead_gen: 'Lead Gen',
  content: 'Content',
  marketplace: 'Marketplace',
};

export function Step1BusinessType({ onNext }: Step1Props) {
  const { businessType, setBusinessType, loadFromTemplate } = useJourneyWizardStore();
  const [templates, setTemplates] = useState<SavedTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    listTemplates()
      .then((data) => setTemplates(data.filter((t) => !t.is_system)))
      .catch(() => setTemplates([]))
      .finally(() => setLoadingTemplates(false));
  }, []);

  function handleSelect(type: BusinessType) {
    setBusinessType(type);
    setTimeout(onNext, 150);
  }

  function handleLoadTemplate(template: SavedTemplate) {
    loadFromTemplate(template);
  }

  async function handleDelete(templateId: string) {
    if (!window.confirm('Delete this template?')) return;
    setDeletingId(templateId);
    try {
      await deleteUserTemplate(templateId);
      setTemplates((prev) => prev.filter((t) => t.id !== templateId));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-center">What kind of site do you have?</h2>
      <p className="mt-2 text-center text-muted-foreground">
        Atlas will pre-load a journey template that matches your funnel.
      </p>

      <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
        {BUSINESS_TYPE_OPTIONS.map((option) => (
          <button
            key={option.value}
            onClick={() => handleSelect(option.value)}
            className={cn(
              'flex flex-col items-center rounded-xl border-2 p-5 text-left transition-all hover:border-brand-400 hover:shadow-sm',
              businessType === option.value
                ? 'border-brand-500 bg-brand-50 shadow-sm'
                : 'border-border bg-background'
            )}
          >
            <span className="text-3xl mb-3">{option.icon}</span>
            <span className="font-semibold">{option.title}</span>
            <span className="mt-1 text-xs text-muted-foreground text-center">{option.description}</span>
            {option.stageCount > 0 && (
              <span className="mt-3 text-xs text-brand-600">
                {option.stageCount} stages pre-loaded
              </span>
            )}
          </button>
        ))}
      </div>

      {/* My Templates */}
      {loadingTemplates && (
        <div className="mt-8 animate-pulse">
          <div className="h-4 w-32 rounded bg-muted mb-3" />
          <div className="space-y-2">
            {[0, 1].map((i) => (
              <div key={i} className="h-14 rounded-xl bg-muted" />
            ))}
          </div>
        </div>
      )}

      {!loadingTemplates && templates.length > 0 && (
        <div className="mt-8">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            My Saved Templates
          </h3>
          <div className="space-y-2">
            {templates.map((template) => (
              <div
                key={template.id}
                className="flex items-center justify-between rounded-xl border bg-background px-4 py-3 hover:border-brand-300 transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{template.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {BUSINESS_TYPE_LABELS[template.business_type] ?? template.business_type}
                    {' · '}
                    {template.template_data.stages.length} stages
                  </p>
                </div>
                <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => handleLoadTemplate(template)}
                    className="bg-brand-600 hover:bg-brand-700 h-7 text-xs"
                  >
                    Load
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleDelete(template.id)}
                    disabled={deletingId === template.id}
                    className="h-7 text-xs text-muted-foreground hover:text-destructive hover:border-destructive"
                    aria-label="Delete template"
                  >
                    {deletingId === template.id ? '…' : '×'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
