import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { Button } from '@/components/ui/button';
import { useJourneyWizardStore } from '@/store/journeyWizardStore';
import { StageCard } from './StageCard';

interface Step2Props {
  onNext: () => void;
  onBack: () => void;
}

export function Step2JourneyEditor({ onNext, onBack }: Step2Props) {
  const { stages, addStage, reorderStages, canProceedFromStep } = useJourneyWizardStore();
  const canProceed = canProceedFromStep(2);

  const noUrls = stages.every((s) => !s.sampleUrl);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = stages.findIndex((s) => s.id === active.id);
    const newIndex = stages.findIndex((s) => s.id === over.id);
    reorderStages(arrayMove(stages, oldIndex, newIndex));
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-center">
        Here's your customer journey — adjust it to match your site
      </h2>
      <p className="mt-2 text-center text-muted-foreground text-sm">
        Rename stages, paste your real URLs, and toggle what happens on each page. Drag to reorder.
      </p>

      {noUrls && stages.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          Without URLs, Atlas can't simulate your site. You'll get a tracking spec but no audit results.
        </div>
      )}

      {stages.length < 2 && (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
          Add at least 2 stages to continue.
        </div>
      )}

      <div className="mt-6 space-y-3">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={stages.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            {stages.map((stage) => (
              <div key={stage.id}>
                <StageCard stage={stage} canRemove={stages.length > 1} />
                <div className="flex justify-center my-1">
                  <div className="relative flex items-center w-full">
                    <div className="flex-1 border-t" />
                    <AddStageButton onAdd={() => addStage(stage.order)} />
                    <div className="flex-1 border-t" />
                  </div>
                </div>
              </div>
            ))}
          </SortableContext>
        </DndContext>

        {stages.length === 0 && (
          <AddStageButton onAdd={() => addStage(0)} label="+ Add First Stage" />
        )}
      </div>

      <div className="mt-8 flex gap-3">
        <Button type="button" variant="outline" onClick={onBack} className="flex-1">
          Back
        </Button>
        <Button
          type="button"
          onClick={onNext}
          disabled={!canProceed}
          className="flex-1 bg-[#1B2A4A] hover:bg-[#1B2A4A]"
        >
          Next: Select Platforms
        </Button>
      </div>
    </div>
  );
}

function AddStageButton({ onAdd, label = '+ Add Stage' }: { onAdd: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onAdd}
      className="mx-2 flex-shrink-0 rounded-full border border-dashed px-3 py-0.5 text-xs text-muted-foreground hover:border-[#1B2A4A]/40 hover:text-[#1B2A4A] transition-colors"
    >
      {label}
    </button>
  );
}
