import { useState } from 'react';
import type * as React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Platform, ImplementationFormat } from '@/types/journey';
import { PLATFORM_OPTIONS } from '@/types/journey';
import { useJourneyWizardStore } from '@/store/journeyWizardStore';

interface Step3Props {
  onNext: () => void;
  onBack: () => void;
}

const FORMAT_OPTIONS: { value: ImplementationFormat; label: string; description: string }[] = [
  { value: 'gtm', label: 'Google Tag Manager', description: "Most common — we'll generate dataLayer.push() code and a GTM container JSON" },
];

export function Step3PlatformSelector({ onNext, onBack }: Step3Props) {
  const { platforms, implementationFormat, secondaryDomains, togglePlatform, setPlatformId, setImplementationFormat, setSecondaryDomains, canProceedFromStep } = useJourneyWizardStore();
  const canProceed = canProceedFromStep(3);

  const [domainInput, setDomainInput] = useState('');

  function addDomain() {
    const trimmed = domainInput.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!trimmed || secondaryDomains.includes(trimmed)) { setDomainInput(''); return; }
    setSecondaryDomains([...secondaryDomains, trimmed]);
    setDomainInput('');
  }

  function removeDomain(domain: string) {
    setSecondaryDomains(secondaryDomains.filter((d) => d !== domain));
  }

  function handleDomainKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); addDomain(); }
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-center">
        Where do you send your tracking data?
      </h2>
      <p className="mt-2 text-center text-muted-foreground text-sm">
        Select the platforms you use. Platform IDs are optional — Atlas can detect them.
      </p>

      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {PLATFORM_OPTIONS.map((option) => {
          const selection = platforms.find((p) => p.platform === option.value)!;
          return (
            <div
              key={option.value}
              className={cn(
                'rounded-xl border-2 p-4 transition-all',
                selection.isActive ? 'border-[#1B2A4A] bg-[#EEF1F7]' : 'border-border bg-background'
              )}
            >
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selection.isActive}
                  onChange={() => togglePlatform(option.value as Platform)}
                  className="h-4 w-4 rounded border-gray-300 text-[#1B2A4A] focus:ring-[#1B2A4A]"
                />
                <div>
                  <span className="inline-block rounded bg-muted px-1.5 py-0.5 text-xs font-mono font-semibold mr-1">
                    {option.logo}
                  </span>
                  <span className="text-sm font-medium">{option.label}</span>
                </div>
              </label>

              {selection.isActive && (
                <div className="mt-3">
                  <Input
                    type="text"
                    value={selection.measurementId}
                    onChange={(e) => setPlatformId(option.value as Platform, e.target.value)}
                    placeholder={option.idPlaceholder}
                    className="h-7 text-xs"
                  />
                  <p className="mt-0.5 text-xs text-muted-foreground">{option.idLabel} (optional)</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!canProceed && (
        <p className="mt-3 text-center text-sm text-destructive">Select at least one platform to continue.</p>
      )}

      <div className="mt-8">
        <h3 className="text-sm font-semibold">How is tracking set up on your site?</h3>
        <div className="mt-3 space-y-2">
          {FORMAT_OPTIONS.map((fmt) => (
            <label key={fmt.value} className="flex items-start gap-3 cursor-pointer rounded-lg border p-3 hover:border-[#1B2A4A]/30 transition-colors">
              <input
                type="radio"
                value={fmt.value}
                checked={implementationFormat === fmt.value}
                onChange={() => setImplementationFormat(fmt.value)}
                className="mt-0.5 h-4 w-4 border-gray-300 text-[#1B2A4A] focus:ring-[#1B2A4A]"
              />
              <div>
                <span className="text-sm font-medium">{fmt.label}</span>
                <p className="text-xs text-muted-foreground">{fmt.description}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Cross-domain tracking */}
      <div className="mt-8">
        <h3 className="text-sm font-semibold">Cross-domain tracking</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          If users move from this site to a separate domain during their journey (e.g. a checkout subdomain), add those domains here. Atlas will configure GA4 linked_domains and the Conversion Linker automatically.
        </p>
        <div className="mt-3 flex gap-2">
          <Input
            type="text"
            value={domainInput}
            onChange={(e) => setDomainInput(e.target.value)}
            onKeyDown={handleDomainKeyDown}
            placeholder="checkout.example.com"
            className="h-8 text-sm"
          />
          <Button type="button" size="sm" variant="outline" onClick={addDomain} className="shrink-0">
            Add
          </Button>
        </div>
        {secondaryDomains.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {secondaryDomains.map((d) => (
              <span key={d} className="flex items-center gap-1 rounded-full border border-[#1B2A4A]/30 bg-[#EEF1F7] px-2.5 py-0.5 text-xs font-medium text-[#1B2A4A]">
                {d}
                <button type="button" onClick={() => removeDomain(d)} className="ml-0.5 text-[#1B2A4A]/60 hover:text-[#1B2A4A]" aria-label={`Remove ${d}`}>×</button>
              </span>
            ))}
          </div>
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
          Next: Review
        </Button>
      </div>
    </div>
  );
}
