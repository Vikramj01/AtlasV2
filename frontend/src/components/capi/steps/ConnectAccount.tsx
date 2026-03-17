/**
 * SetupWizard — Step 1: Connect your Meta account
 * File: frontend/src/components/capi/steps/ConnectAccount.tsx
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useCAPIStore } from '@/store/capiStore';
import type { MetaCredentials } from '@/types/capi';

interface ConnectAccountProps {
  onNext: () => void;
}

export function ConnectAccount({ onNext }: ConnectAccountProps) {
  const { wizardDraft, setWizardDraft } = useCAPIStore();

  const draft = wizardDraft.credentials as Partial<MetaCredentials>;

  const [pixelId, setPixelId] = useState(draft.pixel_id ?? '');
  const [accessToken, setAccessToken] = useState(draft.access_token ?? '');
  const [datasetId, setDatasetId] = useState(draft.dataset_id ?? '');
  const [testEventCode, setTestEventCode] = useState(wizardDraft.test_event_code ?? '');
  const [showToken, setShowToken] = useState(false);
  const [errors, setErrors] = useState<{ pixel_id?: string; access_token?: string }>({});

  function validate(): boolean {
    const next: { pixel_id?: string; access_token?: string } = {};
    if (!pixelId.trim()) next.pixel_id = 'Pixel ID is required.';
    if (!accessToken.trim()) next.access_token = 'System User Access Token is required.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setWizardDraft({
      credentials: {
        pixel_id: pixelId.trim(),
        access_token: accessToken.trim(),
        dataset_id: datasetId.trim(),
      },
      test_event_code: testEventCode.trim(),
    });
    onNext();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect your Meta account</CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          Step 1 of 5 — Provide your Meta Pixel credentials to get started.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          {/* Pixel ID */}
          <div className="space-y-1">
            <label htmlFor="pixel_id" className="block text-sm font-medium">
              Pixel ID
            </label>
            <input
              id="pixel_id"
              type="text"
              value={pixelId}
              onChange={(e) => setPixelId(e.target.value)}
              placeholder="123456789012345"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {errors.pixel_id && (
              <p className="text-xs text-destructive">{errors.pixel_id}</p>
            )}
          </div>

          {/* System User Access Token */}
          <div className="space-y-1">
            <label htmlFor="access_token" className="block text-sm font-medium">
              System User Access Token
            </label>
            <div className="relative">
              <input
                id="access_token"
                type={showToken ? 'text' : 'password'}
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder="Enter your system user access token"
                className="w-full rounded-md border border-input bg-background px-3 py-2 pr-20 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                type="button"
                onClick={() => setShowToken((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground focus:outline-none"
              >
                {showToken ? 'Hide' : 'Show'}
              </button>
            </div>
            {errors.access_token && (
              <p className="text-xs text-destructive">{errors.access_token}</p>
            )}
          </div>

          {/* Dataset ID (optional) */}
          <div className="space-y-1">
            <label htmlFor="dataset_id" className="block text-sm font-medium">
              Dataset ID{' '}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <input
              id="dataset_id"
              type="text"
              value={datasetId}
              onChange={(e) => setDatasetId(e.target.value)}
              placeholder="Same as Pixel ID if not using a dataset"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Test Event Code */}
          <div className="space-y-1">
            <label htmlFor="test_event_code" className="block text-sm font-medium">
              Test Event Code
            </label>
            <input
              id="test_event_code"
              type="text"
              value={testEventCode}
              onChange={(e) => setTestEventCode(e.target.value)}
              placeholder="TEST12345"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="text-xs text-muted-foreground">
              Get this from Meta Events Manager &rarr; Test Events tab
            </p>
          </div>

          {/* Helper box */}
          <div className="rounded-md bg-muted px-4 py-3 text-sm text-muted-foreground">
            💡 Create a System User in your Meta Business Manager with standard access to your
            pixel. Never use a personal account token.
          </div>

          <div className="flex justify-end">
            <Button type="submit">Next</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
