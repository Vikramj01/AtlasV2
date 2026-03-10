import { Card, CardContent } from '@/components/ui/card';
import { WizardProgress } from './WizardProgress';
import { Step1BusinessType } from './Step1BusinessType';
import { Step2JourneyEditor } from './Step2JourneyEditor';
import { Step3PlatformSelector } from './Step3PlatformSelector';
import { Step4Review } from './Step4Review';
import { useJourneyWizardStore } from '@/store/journeyWizardStore';

export function JourneyWizard() {
  const { currentStep, goToStep } = useJourneyWizardStore();

  function next() {
    if (currentStep < 4) goToStep((currentStep + 1) as 1 | 2 | 3 | 4);
  }

  function back() {
    if (currentStep > 1) goToStep((currentStep - 1) as 1 | 2 | 3 | 4);
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <WizardProgress currentStep={currentStep} />

      <Card>
        <CardContent className="p-6">
          {currentStep === 1 && <Step1BusinessType onNext={next} />}
          {currentStep === 2 && <Step2JourneyEditor onNext={next} onBack={back} />}
          {currentStep === 3 && <Step3PlatformSelector onNext={next} onBack={back} />}
          {currentStep === 4 && <Step4Review onBack={back} />}
        </CardContent>
      </Card>
    </div>
  );
}
