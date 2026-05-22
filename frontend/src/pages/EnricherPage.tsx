/**
 * EnricherPage — /integrations/enricher
 *
 * Bid Signal Enricher: push first-party audience data to multiple Google
 * destinations (Google Ads, GA4, DV360, CM360) in a single call.
 */

import { useState, useEffect } from 'react';
import { Loader2, X } from 'lucide-react';
import { PlanGate } from '@/components/common/PlanGate';
import { Button } from '@/components/ui/button';
import { enricherApi } from '@/lib/api/enricherApi';
import type { EnricherDestination, EnricherRun } from '@/lib/api/enricherApi';

// ── Types ─────────────────────────────────────────────────────────────────────

type DestType = EnricherDestination['type'];

interface DestinationRow {
  type: DestType;
  id: string; // customerId | propertyId | advertiserId
}

type OperationType = 'CREATE' | 'REMOVE';

// ── Helpers ───────────────────────────────────────────────────────────────────

const DEST_TYPES: DestType[] = ['GOOGLE_ADS', 'GA4', 'DV360', 'CM360'];

const DEST_LABELS: Record<DestType, string> = {
  GOOGLE_ADS: 'Google Ads',
  GA4: 'GA4',
  DV360: 'DV360',
  CM360: 'CM360',
};

function idLabel(type: DestType): string {
  switch (type) {
    case 'GOOGLE_ADS': return 'Customer ID';
    case 'GA4':        return 'Property ID';
    case 'DV360':      return 'Advertiser ID';
    case 'CM360':      return 'Advertiser ID';
  }
}

function destToPayload(row: DestinationRow): EnricherDestination {
  switch (row.type) {
    case 'GOOGLE_ADS': return { type: row.type, customerId: row.id };
    case 'GA4':        return { type: row.type, propertyId: row.id };
    case 'DV360':      return { type: row.type, advertiserId: row.id };
    case 'CM360':      return { type: row.type, advertiserId: row.id };
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ', ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function matchRateColour(rate: number | null): string {
  if (rate === null) return 'text-muted-foreground';
  if (rate >= 80) return 'text-emerald-600 font-semibold';
  if (rate >= 50) return 'text-amber-600 font-semibold';
  return 'text-red-600 font-semibold';
}

function statusBadge(status: string): JSX.Element {
  const map: Record<string, string> = {
    completed:  'bg-emerald-100 text-emerald-700',
    failed:     'bg-red-100 text-red-700',
    processing: 'bg-amber-100 text-amber-700',
    pending:    'bg-gray-100 text-gray-600',
  };
  const cls = map[status] ?? 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${cls}`}>
      {status}
    </span>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function TableSkeleton() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <tr key={i} className="border-b border-[#F3F4F6]">
          {[1, 2, 3, 4, 5, 6].map((j) => (
            <td key={j} className="px-4 py-3">
              <div className="h-4 w-full animate-pulse rounded bg-[#F3F4F6]" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function EnricherPage() {
  // ── Destination rows ────────────────────────────────────────────────────────
  const [destinations, setDestinations] = useState<DestinationRow[]>([
    { type: 'GOOGLE_ADS', id: '' },
  ]);

  // ── Operation ───────────────────────────────────────────────────────────────
  const [operation, setOperation] = useState<OperationType>('CREATE');

  // ── Contacts textarea ───────────────────────────────────────────────────────
  const [contactsRaw, setContactsRaw] = useState('');

  // ── Submit state ────────────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<{
    record_count: number;
    matched_count: number;
    match_rate: number;
  } | null>(null);

  // ── Run history ─────────────────────────────────────────────────────────────
  const [runs, setRuns] = useState<EnricherRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState<string | null>(null);

  function loadRuns() {
    setRunsLoading(true);
    setRunsError(null);
    enricherApi.listRuns()
      .then(({ data }) => setRuns(data))
      .catch((err: unknown) => setRunsError(err instanceof Error ? err.message : 'Failed to load runs'))
      .finally(() => setRunsLoading(false));
  }

  useEffect(() => {
    loadRuns();
  }, []);

  // ── Destination helpers ─────────────────────────────────────────────────────

  function addDestination() {
    if (destinations.length >= 3) return;
    setDestinations((prev: DestinationRow[]) => [...prev, { type: 'GOOGLE_ADS', id: '' }]);
  }

  function removeDestination(index: number) {
    setDestinations((prev: DestinationRow[]) => prev.filter((_: DestinationRow, i: number) => i !== index));
  }

  function updateDestType(index: number, type: DestType) {
    setDestinations((prev: DestinationRow[]) =>
      prev.map((d: DestinationRow, i: number) => (i === index ? { type, id: '' } : d)),
    );
  }

  function updateDestId(index: number, id: string) {
    setDestinations((prev: DestinationRow[]) =>
      prev.map((d: DestinationRow, i: number) => (i === index ? { ...d, id } : d)),
    );
  }

  // ── Submit ──────────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitSuccess(null);

    const contacts = contactsRaw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((email) => ({ email }));

    if (contacts.length === 0) {
      setSubmitError('Please enter at least one email address.');
      return;
    }

    const payloadDests = destinations.map(destToPayload);

    setSubmitting(true);
    try {
      const { data } = await enricherApi.triggerRun({
        destinations: payloadDests,
        contacts,
        operation_type: operation,
      });
      setSubmitSuccess({
        record_count: data.record_count,
        matched_count: data.matched_count,
        match_rate: data.match_rate,
      });
      loadRuns();
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Push failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <PlanGate minPlan="pro" featureName="Bid Signal Enricher">
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground">Bid Signal Enricher</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Push first-party audience data to multiple Google destinations in a single call.
          </p>
        </div>

        {/* Upload form card */}
        <div className="rounded-xl border border-[#E5E7EB] bg-white p-6 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-6">

            {/* Destinations */}
            <div className="space-y-3">
              <label className="text-sm font-semibold text-foreground">Destinations</label>
              <div className="space-y-2">
                {destinations.map((dest, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    {/* Type selector */}
                    <select
                      value={dest.type}
                      onChange={(e) => updateDestType(idx, e.target.value as DestType)}
                      className="h-9 rounded-md border border-[#E5E7EB] bg-white px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20"
                    >
                      {DEST_TYPES.map((t) => (
                        <option key={t} value={t}>{DEST_LABELS[t]}</option>
                      ))}
                    </select>

                    {/* Conditional ID input */}
                    <input
                      type="text"
                      value={dest.id}
                      onChange={(e) => updateDestId(idx, e.target.value)}
                      placeholder={idLabel(dest.type)}
                      className="h-9 flex-1 rounded-md border border-[#E5E7EB] bg-white px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20"
                    />

                    {/* Remove button */}
                    {destinations.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeDestination(idx)}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[#E5E7EB] text-muted-foreground transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-600"
                        aria-label="Remove destination"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {destinations.length < 3 && (
                <button
                  type="button"
                  onClick={addDestination}
                  className="text-sm font-medium text-[#1B2A4A] hover:underline"
                >
                  + Add destination
                </button>
              )}
            </div>

            {/* Operation toggle */}
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">Operation</label>
              <div className="inline-flex rounded-full border border-[#1B2A4A] bg-white p-0.5">
                <button
                  type="button"
                  onClick={() => setOperation('CREATE')}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                    operation === 'CREATE'
                      ? 'bg-[#1B2A4A] text-white'
                      : 'text-[#1B2A4A] hover:bg-[#1B2A4A]/5'
                  }`}
                >
                  Add to audience
                </button>
                <button
                  type="button"
                  onClick={() => setOperation('REMOVE')}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                    operation === 'REMOVE'
                      ? 'bg-[#1B2A4A] text-white'
                      : 'text-[#1B2A4A] hover:bg-[#1B2A4A]/5'
                  }`}
                >
                  Remove from audience
                </button>
              </div>
            </div>

            {/* Contacts textarea */}
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground" htmlFor="enricher-contacts">
                Email addresses (one per line)
              </label>
              <textarea
                id="enricher-contacts"
                rows={6}
                value={contactsRaw}
                onChange={(e) => setContactsRaw(e.target.value)}
                placeholder="user@example.com"
                className="w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 resize-y"
              />
            </div>

            {/* Error banner */}
            {submitError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {submitError}
              </div>
            )}

            {/* Success banner */}
            {submitSuccess && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                Run complete — {submitSuccess.record_count} records pushed, {submitSuccess.matched_count} matched ({submitSuccess.match_rate.toFixed(1)}% match rate).
              </div>
            )}

            {/* Submit */}
            <div>
              <Button
                type="submit"
                disabled={submitting}
                className="bg-[#1B2A4A] text-white hover:bg-[#1B2A4A]/90"
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Pushing…
                  </>
                ) : (
                  'Push to Google'
                )}
              </Button>
            </div>
          </form>
        </div>

        {/* Run history card */}
        <div className="rounded-xl border border-[#E5E7EB] bg-white shadow-sm">
          <div className="border-b border-[#E5E7EB] px-6 py-4">
            <h2 className="text-base font-semibold text-foreground">Run History</h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#F3F4F6] bg-[#F9FAFB]">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Destinations</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Records</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Matched</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Match Rate</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {runsLoading ? (
                  <TableSkeleton />
                ) : runsError ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-red-600">
                      {runsError}
                    </td>
                  </tr>
                ) : runs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-sm text-muted-foreground">
                      No enricher runs yet.
                    </td>
                  </tr>
                ) : (
                  runs.map((run) => (
                    <tr key={run.id} className="border-b border-[#F3F4F6] last:border-0 hover:bg-[#F9FAFB]">
                      {/* Date */}
                      <td className="whitespace-nowrap px-4 py-3 text-foreground">
                        {formatDate(run.created_at)}
                      </td>

                      {/* Destinations */}
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {Array.isArray(run.destinations) && run.destinations.map((d, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center rounded-full bg-[#EEF1F7] px-2 py-0.5 text-xs font-medium text-[#1B2A4A]"
                            >
                              {d.type}
                            </span>
                          ))}
                        </div>
                      </td>

                      {/* Records */}
                      <td className="px-4 py-3 text-right text-foreground">
                        {run.record_count.toLocaleString()}
                      </td>

                      {/* Matched */}
                      <td className="px-4 py-3 text-right text-foreground">
                        {run.matched_count !== null ? run.matched_count.toLocaleString() : '—'}
                      </td>

                      {/* Match Rate */}
                      <td className={`px-4 py-3 text-right ${matchRateColour(run.match_rate)}`}>
                        {run.match_rate !== null ? `${run.match_rate.toFixed(1)}%` : '—'}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        {statusBadge(run.status)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </PlanGate>
  );
}
