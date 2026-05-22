import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronLeft } from 'lucide-react';
import { useJourneyWizardStore } from '@/store/journeyWizardStore';

interface Step2_6GTGPreflightProps {
  onNext: () => void;
  onBack: () => void;
}

type CDNTab = 'cloudflare' | 'akamai' | 'fastly' | 'gcp';

const CDN_TABS: { value: CDNTab; label: string }[] = [
  { value: 'cloudflare', label: 'Cloudflare' },
  { value: 'akamai',     label: 'Akamai' },
  { value: 'fastly',     label: 'Fastly' },
  { value: 'gcp',        label: 'GCP' },
];

const CDN_GUIDES: Record<CDNTab, { title: string; body: string }> = {
  cloudflare: {
    title: 'Cloudflare Workers',
    body: 'Add a Worker that proxies `https://www.googletagmanager.com/gtag/js` to your domain at `/gtag/js`. Enable with 1 rule in the Workers dashboard.',
  },
  akamai: {
    title: 'Akamai EdgeWorkers',
    body: 'Use EdgeWorkers to proxy the GTG script endpoint. Configure a Property Manager rule to forward `/gtag/js` requests to the GTG origin.',
  },
  fastly: {
    title: 'Fastly VCL',
    body: 'Create a VCL snippet that routes `/gtag/js` to the GTG backend. Set `bereq.url` to the GTG path.',
  },
  gcp: {
    title: 'GCP Cloud CDN',
    body: 'Use Cloud Load Balancing + Cloud CDN. Add a backend bucket or service that forwards to the GTG origin. Configure URL map rules for `/gtag/js`.',
  },
};

const NAVY = '#1B2A4A';

export function Step2_6GTGPreflight({ onNext, onBack }: Step2_6GTGPreflightProps) {
  const { setGtgPreflightDismissed } = useJourneyWizardStore();
  const [activeTab, setActiveTab] = useState<CDNTab>('cloudflare');

  function handleDeployed() {
    setGtgPreflightDismissed(true);
    onNext();
  }

  function handleSkip() {
    onNext();
  }

  const guide = CDN_GUIDES[activeTab];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Google Tag Gateway (GTG) check</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Optional CDN-side configuration that improves signal quality.
        </p>
      </div>

      {/* Info card */}
      <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
        <p className="text-sm font-medium">What is Google Tag Gateway?</p>
        <p className="text-sm text-muted-foreground">
          Google Tag Gateway runs gtag.js through your CDN rather than google.com, reducing
          ITP-related cookie restrictions and adding ~11% signal uplift. It's free to deploy.
        </p>
      </div>

      {/* GTG status */}
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium">Status:</span>
        <span className="text-muted-foreground">Not yet detected</span>
      </div>

      {/* CDN deployment guide */}
      <div className="space-y-3">
        <p className="text-sm font-medium">CDN deployment guide</p>

        {/* Tab bar */}
        <div className="flex gap-1 border-b border-border">
          {CDN_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setActiveTab(tab.value)}
              className={
                activeTab === tab.value
                  ? 'px-3 py-2 text-xs font-semibold border-b-2 -mb-px'
                  : 'px-3 py-2 text-xs text-muted-foreground hover:text-foreground'
              }
              style={activeTab === tab.value ? { borderColor: NAVY, color: NAVY } : undefined}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="rounded-md border border-border bg-muted/20 p-4 space-y-1">
          <p className="text-xs font-semibold text-foreground">{guide.title}</p>
          <p className="text-xs text-muted-foreground">{guide.body}</p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-3">
        <Button
          onClick={handleDeployed}
          className="w-full"
          style={{ backgroundColor: NAVY }}
        >
          GTG is deployed — continue
        </Button>
        <Button variant="ghost" onClick={handleSkip} className="w-full text-muted-foreground">
          Skip for now
        </Button>
        <Button variant="ghost" onClick={onBack} className="w-full text-muted-foreground">
          <ChevronLeft className="mr-1 size-4" />
          Back
        </Button>
      </div>
    </div>
  );
}
