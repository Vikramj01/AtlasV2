import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlanningStore } from '@/store/planningStore';
import { planningApi } from '@/lib/api/planningApi';
import type { OutputType } from '@/types/planning';

const OUTPUT_LABELS: Record<OutputType, string> = {
  gtm_container:        'GTM Container JSON',
  datalayer_spec:       'DataLayer Specification',
  implementation_guide: 'Implementation Guide (HTML)',
};

const OUTPUT_EXT: Record<OutputType, string> = {
  gtm_container:        'json',
  datalayer_spec:       'json',
  implementation_guide: 'html',
};

export function Step7DownloadAndHandoff() {
  const navigate = useNavigate();
  const { currentSession, outputs, reset } = usePlanningStore();

  const sessionId = currentSession?.id ?? '';
  const [isHandingOff, setIsHandingOff] = useState(false);
  const [handoffError, setHandoffError] = useState<string | null>(null);

  async function handleStartAudit() {
    setIsHandingOff(true);
    setHandoffError(null);
    try {
      const { journey_id } = await planningApi.handoff(sessionId);
      reset();
      navigate(`/journey/${journey_id}/spec`);
    } catch (err) {
      setHandoffError(err instanceof Error ? err.message : 'Handoff failed');
    } finally {
      setIsHandingOff(false);
    }
  }

  async function handleDownload(outputId: string, outputType: OutputType, downloadUrl?: string) {
    try {
      let blob: Blob;
      if (downloadUrl) {
        const res = await fetch(downloadUrl);
        blob = await res.blob();
      } else {
        blob = await planningApi.downloadOutput(sessionId, outputId);
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `atlas-${outputType}.${OUTPUT_EXT[outputType]}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download failed:', err);
    }
  }

  function handleReturnToDashboard() {
    reset();
    navigate('/planning');
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-12">
      {/* Success header */}
      <div className="mb-10 text-center">
        <div className="mb-4 text-5xl">🚀</div>
        <h2 className="text-2xl font-bold text-gray-900">Your tracking plan is ready!</h2>
        <p className="mt-2 text-sm text-gray-500">
          Share the files below with your developer. Once tracking is live, come back to verify it
          with Atlas Audit Mode.
        </p>
      </div>

      {/* Downloads */}
      {outputs.length > 0 && (
        <section className="mb-8 rounded-xl border border-gray-100 bg-white p-5">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Download your files
          </h3>
          <div className="space-y-2">
            {outputs.map((output) => (
              <div
                key={output.id}
                className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-gray-800">
                    {OUTPUT_LABELS[output.output_type]}
                  </p>
                  {output.file_size_bytes && (
                    <p className="text-xs text-gray-400">
                      {output.file_size_bytes > 1024
                        ? `${(output.file_size_bytes / 1024).toFixed(1)} KB`
                        : `${output.file_size_bytes} B`}
                    </p>
                  )}
                </div>
                <button
                  onClick={() =>
                    handleDownload(output.id, output.output_type, output.download_url)
                  }
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-white"
                >
                  ↓ Download
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Next steps */}
      <section className="mb-8 rounded-xl border border-gray-100 bg-white p-5">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
          What happens next?
        </h3>
        <ol className="space-y-3">
          {[
            {
              step: '1',
              title: 'Hand off to your developer',
              body: 'Share the Implementation Guide and DataLayer Spec with your dev team.',
            },
            {
              step: '2',
              title: 'Import the GTM container',
              body: 'Your developer or GTM admin imports the JSON file and fills in your platform IDs.',
            },
            {
              step: '3',
              title: 'Test in GTM Preview Mode',
              body: 'Use Tag Assistant to verify every event fires on the right page.',
            },
            {
              step: '4',
              title: 'Verify with Atlas Audit Mode',
              body: 'Come back here to run an automated audit that validates every signal end-to-end.',
            },
          ].map(({ step, title, body }) => (
            <li key={step} className="flex gap-3">
              <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
                {step}
              </span>
              <div>
                <p className="text-sm font-medium text-gray-800">{title}</p>
                <p className="text-xs text-gray-500">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Handoff error */}
      {handoffError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {handoffError}
        </div>
      )}

      {/* CTA buttons */}
      <div className="flex flex-col gap-3">
        <button
          onClick={handleStartAudit}
          disabled={isHandingOff}
          className="w-full rounded-lg bg-brand-600 py-3 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
        >
          {isHandingOff ? (
            <span className="flex items-center justify-center gap-2">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Creating audit journey…
            </span>
          ) : (
            '🔍 Set Up Audit Mode →'
          )}
        </button>

        <button
          onClick={handleReturnToDashboard}
          className="w-full rounded-lg border border-gray-200 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50"
        >
          Return to Dashboard
        </button>
      </div>

      <p className="mt-4 text-center text-xs text-gray-400">
        The Audit Mode journey has been pre-populated from your approved recommendations.
        You can review and adjust it before running the first audit.
      </p>
    </div>
  );
}
